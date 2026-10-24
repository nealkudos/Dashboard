// Live Monzo transactions through Monzo's own developer API (personal use, your account only).
//   MONZO_CLIENT_ID      from developers.monzo.com → Clients → New OAuth client (Confidential: Yes)
//   MONZO_CLIENT_SECRET  (Secret) from the same page
//   MONZO_API_URL / MONZO_AUTH_URL  optional overrides, only used for local testing
import { kv } from "./core.js";
import { randomId, sha256Hex } from "./crypto.js";
import { getAccounts, putAccounts, purgeAccount, getBudget, putBudget, makeTx, mergeTransactions } from "./budget.js";

const api = (env) => (env.MONZO_API_URL || "https://api.monzo.com").replace(/\/+$/, "");
const authBase = (env) => (env.MONZO_AUTH_URL || "https://auth.monzo.com").replace(/\/+$/, "");
export const monzoConfigured = (env) => !!(env.MONZO_CLIENT_ID && env.MONZO_CLIENT_SECRET);

const getState = async (env) => (await kv(env).get("monzo", "json")) || null;
const putState = (env, s) => kv(env).put("monzo", JSON.stringify(s));

// ---------- Connecting ----------
export async function monzoConnectUrl(env, origin) {
  const state = randomId(24);
  await kv(env).put(`monzostate:${state}`, "1", { expirationTtl: 1800 });
  const q = new URLSearchParams({ client_id: env.MONZO_CLIENT_ID, redirect_uri: `${origin}/monzo-callback`, response_type: "code", state });
  return `${authBase(env)}/?${q}`;
}

async function tokenRequest(env, fields) {
  const res = await fetch(`${api(env)}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MONZO_CLIENT_ID, client_secret: env.MONZO_CLIENT_SECRET, ...fields }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new Error(`Monzo sign-in failed: ${d.message || d.error_description || d.error || res.status}`);
  return d;
}

export async function monzoFinish(env, state, code, origin) {
  if (!/^[a-f0-9]{48}$/.test(state || "") || !code) throw new Error("This link isn't valid — start again from the Budget page.");
  if (!(await kv(env).get(`monzostate:${state}`))) throw new Error("This Monzo sign-in expired — start again from the Budget page.");
  await kv(env).delete(`monzostate:${state}`);
  const t = await tokenRequest(env, { grant_type: "authorization_code", redirect_uri: `${origin}/monzo-callback`, code });
  const old = (await getState(env)) || {};
  await putState(env, {
    access_token: t.access_token,
    refresh_token: t.refresh_token || null,
    expires_at: Date.now() + (t.expires_in || 21600) * 1000,
    connected_at: new Date().toISOString(),
    full_pulled: false,            // pull full history right after approval (Monzo limits it to 90 days after 5 minutes)
    last_sync: old.last_sync || null,
    accounts: old.accounts || [],
  });
}

// ---------- Calling the API ----------
async function accessToken(env, st) {
  if (st.expires_at - 60000 > Date.now()) return st.access_token;
  if (!st.refresh_token) throw Object.assign(new Error("Monzo access ended — reconnect Monzo"), { code: "reconnect" });
  const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: st.refresh_token }).catch((e) => {
    throw Object.assign(new Error(`${e.message} — reconnect Monzo`), { code: "reconnect" });
  });
  Object.assign(st, { access_token: t.access_token, refresh_token: t.refresh_token || st.refresh_token, expires_at: Date.now() + (t.expires_in || 21600) * 1000 });
  await putState(env, st);
  return st.access_token;
}

async function mz(env, st, path) {
  const res = await fetch(`${api(env)}${path}`, { headers: { authorization: `Bearer ${await accessToken(env, st)}` } });
  const d = await res.json().catch(() => ({}));
  if (res.status === 403) throw Object.assign(new Error("Waiting for you to approve access in the Monzo app"), { code: "approve" });
  if (res.status === 401) throw Object.assign(new Error("Monzo access ended — reconnect Monzo"), { code: "reconnect" });
  if (!res.ok) throw new Error(`Monzo: ${d.message || res.status}`);
  return d;
}

// ---------- Turning Monzo transactions into ours ----------
const CAT = {
  groceries: "Groceries", eating_out: "Eating out", transport: "Transport", bills: "Bills", entertainment: "Entertainment",
  shopping: "Shopping", holidays: "Travel", personal_care: "Health", family: "Family", cash: "Cash", charity: "Other",
  gifts: "Shopping", transfers: "Transfers", savings: "Transfers", income: "Income",
};
const londonDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

async function toTx(acctKey, t) {
  const pot = t.metadata?.pot_id || /^pot_/.test(t.description || "");
  const name = pot ? "Pot transfer" : t.merchant?.name || t.counterparty?.name || t.description;
  let cat = CAT[t.category] || null;
  if (pot) cat = "Transfers";
  if (cat === "Income" && t.amount < 0) cat = null;
  const tx = await makeTx(acctKey, {
    date: londonDate(t.created), amount: t.amount / 100, desc: name, note: t.notes || (name !== t.description ? t.description : ""),
    ref: t.id, cat,
  });
  tx.live = true;
  return tx;
}

// ---------- Sync ----------
/** Pull new Monzo transactions and balances. Returns { status, added, message? }. */
export async function syncMonzo(env, { force = false } = {}) {
  const st = await getState(env);
  if (!st) return { status: "not_connected", added: 0 };
  if (!force && st.full_pulled && st.last_sync && Date.now() - Date.parse(st.last_sync) < 15 * 60 * 1000) return { status: "ok", added: 0, skipped: true };
  try {
    // Accounts (current + joint)
    const list = (await mz(env, st, "/accounts")).accounts || [];
    const mine = list.filter((a) => !a.closed && a.type === "uk_retail");   // personal current account only (no joint)
    const accounts = await getAccounts(env);
    st.accounts = [];
    for (const a of mine) {
      const key = "mz" + (await sha256Hex(`monzo|${a.id}`)).slice(0, 14);
      const name = a.type === "uk_retail_joint" ? "Joint account" : "Current account";
      const mask = String(a.account_number || "").slice(-4);
      st.accounts.push({ id: a.id, key });
      if (!accounts.some((x) => x.key === key)) accounts.push({ key, name, bank: "Monzo", source: "monzo", mask });
    }
    await putAccounts(env, accounts);
    // Any Monzo account we no longer sync (e.g. the joint account) goes, along with its transactions
    for (const old of accounts.filter((x) => x.source === "monzo" && !st.accounts.some((a) => a.key === x.key))) await purgeAccount(env, old.key);

    const budget = await getBudget(env);
    let added = 0;
    for (const a of st.accounts) {
      // First pull after connecting: up to 2 years. After that: the last week (always inside Monzo's 90-day window).
      const days = st.full_pulled ? Math.min(89, Math.max(7, Math.ceil((Date.now() - Date.parse(st.last_sync || 0)) / 86400000) + 7)) : 730;
      const DAY = 86400000, WINDOW = 300 * DAY;   // Monzo refuses more than ~1 year per request, so ask in slices
      const now = Date.now();
      const fresh = [];
      // Last 89 days first (always allowed), then older history in slices.
      const slices = [[Math.max(now - days * DAY, now - 89 * DAY), now + 60000]];
      for (let end = now - 89 * DAY; end > now - days * DAY; end -= WINDOW) slices.push([Math.max(end - WINDOW, now - days * DAY), end]);
      for (const [start, end] of slices) {
        const before = new Date(end).toISOString();
        let since = new Date(start).toISOString();
        try {
          for (let page = 0; page < 40; page++) {
            const q = new URLSearchParams({ account_id: a.id, since, before, limit: "100" });
            q.append("expand[]", "merchant");
            const r = (await mz(env, st, `/transactions?${q}`)).transactions || [];
            for (const t of r) if (!t.decline_reason && t.amount !== 0) fresh.push(await toTx(a.key, t));
            if (r.length < 100) break;
            since = r[r.length - 1].id;      // Monzo pages forward by transaction ID
          }
        } catch (e) {
          // Older than 90 days is only allowed in the first 5 minutes after approval — if that's passed, keep what we can get.
          if (e.code === "approve" && now - start > 89 * DAY) continue;
          throw e;
        }
      }
      added += await mergeTransactions(env, fresh);
      try {
        const b = await mz(env, st, `/balance?account_id=${encodeURIComponent(a.id)}`);
        budget.balances[a.key] = { amount: b.balance / 100, total: b.total_balance / 100, at: new Date().toISOString() };
      } catch { /* balance is a bonus */ }
    }
    st.full_pulled = true;
    st.last_sync = new Date().toISOString();
    st.waiting = false;
    await putState(env, st);
    budget.lastSync = st.last_sync;
    await putBudget(env, budget);
    return { status: "ok", added };
  } catch (e) {
    if (e.code === "approve") { st.waiting = true; await putState(env, st); return { status: "approve", added: 0, message: e.message }; }
    if (e.code === "reconnect") return { status: "reconnect", added: 0, message: e.message };
    throw e;
  }
}

export async function monzoStatus(env) {
  const st = await getState(env);
  if (!st) return { connected: false };
  return { connected: true, waiting: !!st.waiting || !st.full_pulled, last_sync: st.last_sync, can_refresh: !!st.refresh_token };
}

export async function monzoDisconnect(env) {
  const st = await getState(env);
  if (st) {
    try {
      await fetch(`${api(env)}/oauth2/logout`, { method: "POST", headers: { authorization: `Bearer ${st.access_token}` } });
    } catch { /* already logged out */ }
  }
  await kv(env).delete("monzo");
}

// Bank connections through Enable Banking (Open Banking, read-only).
//   EB_APP_ID       the application ID from the Enable Banking control panel (also the key ID)
//   EB_PRIVATE_KEY  (Secret) the contents of the .pem file downloaded when the app was created
//   EB_API_URL      optional, defaults to https://api.enablebanking.com (used for local testing)
import { kv } from "./core.js";
import { sha256Hex, randomId } from "./crypto.js";

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (o) => b64url(enc.encode(JSON.stringify(o)));

export function bankingConfigured(env) {
  return !!(env.EB_APP_ID && env.EB_PRIVATE_KEY);
}

// ---------- Private key (accepts PKCS#8 "BEGIN PRIVATE KEY" or PKCS#1 "BEGIN RSA PRIVATE KEY") ----------
function derLength(n) {
  if (n < 0x80) return [n];
  const out = [];
  while (n > 0) { out.unshift(n & 0xff); n >>= 8; }
  return [0x80 | out.length, ...out];
}
function pkcs1ToPkcs8(pkcs1) {
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [0x02, 0x01, 0x00, ...algId, ...octet];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}
let keyCache = null;
async function signingKey(env) {
  if (keyCache && keyCache.pem === env.EB_PRIVATE_KEY) return keyCache.key;
  const pem = String(env.EB_PRIVATE_KEY).replace(/\\n/g, "\n");
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  let der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (isPkcs1) der = pkcs1ToPkcs8(der);
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  keyCache = { pem: env.EB_PRIVATE_KEY, key };
  return key;
}

async function jwt(env) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64urlJson({ typ: "JWT", alg: "RS256", kid: String(env.EB_APP_ID).trim() });
  const body = b64urlJson({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(env), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

export async function eb(env, method, path, body) {
  const base = (env.EB_API_URL || "https://api.enablebanking.com").replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${await jwt(env)}`, "content-type": "application/json", accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`Couldn't reach Enable Banking (${e.message})`);
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = data.message || data.detail || data.error || text.slice(0, 200) || res.status;
    const err = new Error(`Enable Banking: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    err.status = res.status;
    err.code = data.code || data.error;
    throw err;
  }
  return data;
}

// ---------- Stored data ----------
// conns          [{ id, bank, session_id, valid_until, created, accounts:[{ uid, key, name, mask, currency, kind }] }]
// bt:YYYY-MM     transactions for that month: [{ id, acct, date, amount, desc, cat?, auto }]
// budget         { budgets:{cat:amount}, rules:{merchantKey:cat}, overrides:{txId:cat}, synced:{acctKey:iso}, balances:{acctKey:{...}}, lastSync }
export const getConns = async (env) => (await kv(env).get("bank:conns", "json")) || [];
export const putConns = (env, c) => kv(env).put("bank:conns", JSON.stringify(c));
export const getBudget = async (env) => ({ budgets: {}, rules: {}, overrides: {}, synced: {}, balances: {}, lastSync: null, ...((await kv(env).get("budget", "json")) || {}) });
export const putBudget = (env, b) => kv(env).put("budget", JSON.stringify(b));
export const getMonth = async (env, ym) => (await kv(env).get(`bt:${ym}`, "json")) || [];
export const putMonth = (env, ym, list) => kv(env).put(`bt:${ym}`, JSON.stringify(list));

// ---------- Categories ----------
export const CATEGORIES = [
  "Groceries", "Eating out", "Transport", "Fuel", "Bills", "Housing", "Subscriptions", "Shopping",
  "Health", "Family", "Entertainment", "Travel", "Cash", "Fees", "Other", "Income", "Transfers",
];

const RULES = [
  ["Transfers", /\b(monzo|amex|american express|nationwide (credit )?card|card payment received|payment received|thank you for your payment|transfer (to|from)|to savings|from savings|pot transfer|flex)\b/i],
  ["Income", /\b(salary|wages|payroll|kudos ?av|dividend|interest paid)\b/i],
  ["Groceries", /\b(tesco|sainsbury|asda|aldi|lidl|morrisons|waitrose|co-?op|ocado|iceland|m&s food|marks ?& ?spencer simply food|budgens|costco)\b/i],
  ["Eating out", /\b(mcdonald|kfc|nando|greggs|pret|starbucks|costa|caffe nero|deliveroo|just eat|uber ?eats|domino|pizza|burger|restaurant|cafe|wagamama|five guys|subway|leon|itsu|wasabi)\b/i],
  ["Transport", /\b(tfl|transport for london|trainline|gwr|great western|elizabeth line|uber(?! ?eats)|bolt|addison lee|parking|ringgo|paybyphone|congestion|ulez|dart charge|national rail|avanti|lner)\b/i],
  ["Fuel", /\b(shell|bp |esso|texaco|jet |gulf|murco|petrol|fuel|tesla supercharger)\b/i],
  ["Bills", /\b(british gas|octopus|edf|e\.?on|ovo|thames water|affinity water|council tax|tv licen[cs]e|bt group|virgin media|sky |vodafone|ee limited|three|o2 |giffgaff|insurance|aviva|admiral|direct line)\b/i],
  ["Housing", /\b(mortgage|rent|letting|landlord|estate agent)\b/i],
  ["Subscriptions", /\b(netflix|spotify|apple\.com|itunes|google|youtube|disney|amazon prime|prime video|now tv|audible|icloud|microsoft|adobe|chatgpt|openai|anthropic|claude|patreon|dropbox|notion|canva)\b/i],
  ["Shopping", /\b(amazon|amzn|ebay|argos|currys|john lewis|ikea|b&q|screwfix|toolstation|primark|next |zara|h&m|asos|boots|superdrug|apple store|tk ?maxx|temu|shein|etsy)\b/i],
  ["Health", /\b(pharmacy|chemist|dentist|optician|specsavers|nhs|gym|puregym|the gym|david lloyd|bupa|physio)\b/i],
  ["Entertainment", /\b(cinema|odeon|vue|cineworld|ticketmaster|see tickets|playstation|xbox|steam|nintendo|bet365|sky bet|paddy power)\b/i],
  ["Travel", /\b(airbnb|booking\.com|hotel|premier inn|travelodge|easyjet|ryanair|british airways|jet2|expedia|eurostar)\b/i],
  ["Cash", /\b(atm|cash withdrawal|cashpoint)\b/i],
  ["Fees", /\b(interest charged|late fee|overdraft|fee|charge)\b/i],
];

// Merchant categories (ISO 18245) for when the description gives nothing away
const MCC = [
  [[5411, 5422, 5441, 5451, 5462, 5499], "Groceries"], [[5812, 5813, 5814], "Eating out"],
  [[4111, 4121, 4131, 4112, 7523, 4784], "Transport"], [[5541, 5542, 5983], "Fuel"],
  [[4900, 4814, 4899, 6300], "Bills"], [[5912, 8011, 8021, 8042, 8062, 8099, 7997], "Health"],
  [[4511, 7011, 4722, 3000], "Travel"], [[6010, 6011], "Cash"], [[5815, 5816, 5817, 5818], "Subscriptions"],
  [[7832, 7922, 7995, 7996], "Entertainment"],
];

export function merchantKey(desc) {
  return String(desc || "").toLowerCase().replace(/[0-9*#/\\.,:-]+/g, " ").replace(/\b(ltd|limited|plc|uk|gb|london|card|payment|pos|contactless|visa|debit)\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function autoCategory(tx) {
  const text = `${tx.desc || ""} ${tx.note || ""}`;
  for (const [cat, re] of RULES) {
    if (cat === "Income" && tx.amount < 0) continue;
    if (re.test(text)) return cat;
  }
  if (tx.mcc) {
    const n = parseInt(tx.mcc, 10);
    for (const [codes, cat] of MCC) if (codes.includes(n)) return cat;
  }
  return tx.amount > 0 ? "Income" : "Other";
}

export function categoryOf(tx, budget) {
  return budget.overrides[tx.id] || budget.rules[merchantKey(tx.desc)] || tx.auto || autoCategory(tx);
}

// ---------- Normalising Enable Banking transactions ----------
async function normalise(t, acct) {
  const amt = Math.abs(parseFloat(t.transaction_amount?.amount || "0"));
  const out = t.credit_debit_indicator === "DBIT";
  const signed = out ? -amt : amt;
  const party = out ? t.creditor?.name : t.debtor?.name;
  const info = Array.isArray(t.remittance_information) ? t.remittance_information.join(" ") : (t.remittance_information || "");
  const desc = (party || info || t.bank_transaction_code?.description || "Transaction").replace(/\s+/g, " ").trim().slice(0, 120);
  const date = (t.booking_date || t.value_date || t.transaction_date || "").slice(0, 10);
  const ref = t.entry_reference || t.transaction_id;
  const id = (await sha256Hex(`${acct.key}|${ref || `${date}|${signed}|${desc}|${info}`}`)).slice(0, 20);
  const tx = { id, acct: acct.key, date, amount: Math.round(signed * 100) / 100, desc, note: info && info !== desc ? info.slice(0, 120) : undefined, mcc: t.merchant_category_code || undefined };
  tx.auto = autoCategory(tx);
  return tx;
}

// Money moving between your own connected accounts isn't spending or income: pair them up.
export function markTransfers(list) {
  for (const a of list) {
    if (a.amount >= 0 || a.pair) continue;
    const b = list.find((x) => !x.pair && x.amount > 0 && x.acct !== a.acct && Math.abs(x.amount + a.amount) < 0.005 &&
      Math.abs(Date.parse(x.date) - Date.parse(a.date)) <= 3 * 86400000);
    if (b) { a.pair = b.id; b.pair = a.id; a.auto = b.auto = "Transfers"; }
  }
  return list;
}

// ---------- Sync ----------
const ymOf = (d) => d.slice(0, 7);
const iso = (d) => d.toISOString().slice(0, 10);

/** Pull new transactions and balances for every connected account. Returns a short report. */
export async function syncAll(env, { force = false } = {}) {
  const conns = await getConns(env);
  const budget = await getBudget(env);
  const report = { accounts: 0, added: 0, errors: [] };
  const now = Date.now();
  if (!force && budget.lastSync && now - Date.parse(budget.lastSync) < 6 * 3600 * 1000) {
    return { ...report, skipped: true, lastSync: budget.lastSync };
  }
  const fresh = [];
  for (const c of conns) {
    if (Date.parse(c.valid_until) < now) { report.errors.push(`${c.bank}: access expired — reconnect`); continue; }
    for (const a of c.accounts) {
      report.accounts++;
      try {
        const since = budget.synced[a.key]
          ? iso(new Date(Date.parse(budget.synced[a.key]) - 5 * 86400000))   // overlap a few days to catch late postings
          : iso(new Date(now - 90 * 86400000));
        let key = null, pages = 0;
        do {
          const q = new URLSearchParams({ date_from: since });
          if (key) q.set("continuation_key", key);
          const r = await eb(env, "GET", `/accounts/${encodeURIComponent(a.uid)}/transactions?${q}`);
          for (const t of r.transactions || []) {
            if (t.status && t.status !== "BOOK") continue;   // pending ones change; wait until they're booked
            fresh.push(await normalise(t, a));
          }
          key = r.continuation_key || null;
        } while (key && ++pages < 30);
        budget.synced[a.key] = new Date().toISOString();
        try {
          const b = await eb(env, "GET", `/accounts/${encodeURIComponent(a.uid)}/balances`);
          const pick = (b.balances || []).find((x) => ["CLAV", "ITAV", "ITBD", "CLBD", "XPCD", "ITBD", "OPBD"].includes(x.balance_type)) || (b.balances || [])[0];
          if (pick) budget.balances[a.key] = { amount: parseFloat(pick.balance_amount.amount), currency: pick.balance_amount.currency, type: pick.balance_type, at: new Date().toISOString() };
        } catch { /* balances are a bonus */ }
      } catch (e) {
        if (e.status === 401 || e.status === 403 || /expired|revoked|SESSION/i.test(e.message)) {
          report.errors.push(`${c.bank} ${a.name}: bank access expired or was removed — reconnect`);
        } else {
          report.errors.push(`${c.bank} ${a.name}: ${e.message}`);
        }
      }
    }
  }

  // Merge into month buckets (dedupe by id)
  const byMonth = {};
  for (const t of fresh) (byMonth[ymOf(t.date)] ||= []).push(t);
  const months = {};
  const load = async (ym) => (months[ym] ||= await getMonth(env, ym));
  const touched = new Set();
  for (const [ym, list] of Object.entries(byMonth)) {
    const existing = await load(ym);
    const ids = new Set(existing.map((t) => t.id));
    const added = list.filter((t) => !ids.has(t.id) && (ids.add(t.id), true));
    report.added += added.length;
    if (added.length) { existing.push(...added); touched.add(ym); }
  }
  // Pair transfers, looking into the neighbouring months too (e.g. sent 30 Sep, arrived 1 Oct)
  for (const ym of [...touched]) {
    const [y, m] = ym.split("-").map(Number);
    for (const d of [-1, 1]) {
      const n = new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7);
      await load(n);
      touched.add(n);
    }
  }
  markTransfers(Object.values(months).flat());
  for (const ym of touched) {
    if (months[ym].length) await putMonth(env, ym, months[ym].sort((a, b) => b.date.localeCompare(a.date)));
  }
  budget.lastSync = new Date().toISOString();
  await putBudget(env, budget);
  return report;
}

// ---------- Connecting a bank ----------
export async function startConnect(env, origin, bankName) {
  const banks = await eb(env, "GET", "/aspsps?country=GB&psu_type=personal");
  const bank = (banks.aspsps || []).find((b) => b.name === bankName);
  if (!bank) throw new Error(`Bank "${bankName}" not found`);
  const maxSec = bank.maximum_consent_validity || 90 * 86400;
  const validUntil = new Date(Date.now() + Math.min(maxSec, 180 * 86400) * 1000 - 3600 * 1000);
  const state = randomId(24);
  await kv(env).put(`bankstate:${state}`, JSON.stringify({ bank: bank.name }), { expirationTtl: 1800 });
  const r = await eb(env, "POST", "/auth", {
    access: { valid_until: validUntil.toISOString() },
    aspsp: { name: bank.name, country: "GB" },
    state,
    redirect_url: `${origin}/bank-callback`,
    psu_type: "personal",
  });
  return r.url;
}

export async function finishConnect(env, state, code) {
  if (!/^[a-f0-9]{48}$/.test(state || "") || !code) throw new Error("This link isn't valid — start again from the Budget page.");
  const pending = await kv(env).get(`bankstate:${state}`, "json");
  if (!pending) throw new Error("This bank sign-in expired — start again from the Budget page.");
  await kv(env).delete(`bankstate:${state}`);
  const s = await eb(env, "POST", "/sessions", { code });
  const accounts = await Promise.all((s.accounts || []).map(async (a) => {
    const ident = a.account_id?.iban || a.account_id?.other?.identification || a.uid;
    return {
      uid: a.uid,
      key: (a.identification_hash || (await sha256Hex(`${pending.bank}|${ident}`))).slice(0, 24),
      name: a.name || a.product || (a.cash_account_type === "CARD" ? "Card" : "Account"),
      mask: String(ident).replace(/\s/g, "").slice(-4),
      currency: a.currency || "GBP",
      kind: a.cash_account_type || "",
    };
  }));
  const conns = (await getConns(env)).filter((c) => c.bank !== pending.bank);  // reconnecting replaces the old link
  conns.push({ id: randomId(6), bank: pending.bank, session_id: s.session_id, valid_until: s.access?.valid_until, created: new Date().toISOString(), accounts });
  await putConns(env, conns);
  return { bank: pending.bank, accounts: accounts.length };
}

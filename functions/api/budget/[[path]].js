// /api/budget/* — budget tracker (signed-in only; see _middleware.js).
//   GET    /api/budget/summary?month=YYYY-MM   totals, categories, transactions, accounts
//   POST   /api/budget/monzo/connect           -> { url } to sign in to Monzo
//   POST   /api/budget/sync        {force?}    pull new Monzo transactions
//   POST   /api/budget/import      {account, rows, balance?}   statement upload (rows parsed in the browser)
//   PUT    /api/budget/budgets     {budgets}   monthly limit per category
//   PUT    /api/budget/category    {id, month, cat, always}
//   DELETE /api/budget/account/:key            forget an account (keeps its transactions unless ?purge=1)
//   POST   /api/budget/tx      {date, amount, desc, cat}   add something by hand (cash etc.)
//   DELETE /api/budget/tx/:month/:id           remove one you added by hand
//   PUT    /api/budget/goals   {goals:[{id?, name, emoji, target, saved, due?}]}   savings goals
import { json, fail, readJson, sameOrigin, kv } from "../../_lib/core.js";
import { randomId } from "../../_lib/crypto.js";
import {
  getAccounts, putAccounts, getBudget, putBudget, getMonth, putMonth, makeTx, mergeTransactions,
  categoryOf, merchantKey, CATEGORIES, purgeAccount, clearAccountRange,
} from "../../_lib/budget.js";
import { monzoConfigured, monzoConnectUrl, syncMonzo, monzoStatus, monzoDisconnect } from "../../_lib/monzo.js";

export async function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const route = parts.join("/");
  const method = request.method;
  if (method !== "GET" && !sameOrigin(request)) return fail("Bad origin", 403);
  try {
    if (method === "GET" && route === "summary") return summary(request, env);
    if (method === "POST" && route === "monzo/connect") {
      if (!monzoConfigured(env)) return fail("Monzo isn't set up yet — add MONZO_CLIENT_ID and MONZO_CLIENT_SECRET in Cloudflare.", 503);
      return json({ ok: true, url: await monzoConnectUrl(env, new URL(request.url).origin) });
    }
    if (method === "POST" && route === "sync") {
      const { force } = await readJson(request);
      return json({ ok: true, ...(await syncMonzo(env, { force: !!force })) });
    }
    if (method === "POST" && route === "import") return importRows(request, env);
    if (method === "PUT" && route === "budgets") return setBudgets(request, env);
    if (method === "POST" && route === "tx") return addManual(request, env);
    if (method === "DELETE" && parts[0] === "tx" && parts[1] && parts[2]) return deleteManual(env, parts[1], parts[2]);
    if (method === "PUT" && route === "goals") return setGoals(request, env);
    if (method === "PUT" && route === "category") return setCategory(request, env);
    if (method === "DELETE" && parts[0] === "account" && parts[1]) return removeAccount(request, env, parts[1]);
    return fail("Not found", 404);
  } catch (e) {
    return fail(e.message || "Something went wrong", 500);
  }
}

const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }).slice(0, 7);
const round = (n) => Math.round(n * 100) / 100;

async function summary(request, env) {
  let month = new URL(request.url).searchParams.get("month") || thisMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) month = thisMonth();
  const [accounts, budget, txs, monzo] = await Promise.all([getAccounts(env), getBudget(env), getMonth(env, month), monzoStatus(env)]);
  const acctName = Object.fromEntries(accounts.map((a) => [a.key, `${a.bank} ${a.name}${a.mask ? ` ••${a.mask}` : ""}`]));
  acctName.manual = "Added by you";

  let income = 0, spent = 0;
  const byCat = {};
  const list = txs.map((t) => {
    const cat = categoryOf(t, budget);
    if (cat !== "Transfers") {
      if (cat === "Income" || (t.amount > 0 && cat === "Other")) income += t.amount;
      else { spent -= t.amount; byCat[cat] = (byCat[cat] || 0) - t.amount; }   // refunds in a category reduce it
    }
    return { id: t.id, date: t.date, amount: t.amount, desc: t.desc, note: t.note, cat, account: acctName[t.acct] || "Removed account", manual: t.acct === "manual" };
  });

  const categories = CATEGORIES.filter((c) => !["Income", "Transfers"].includes(c))
    .map((c) => ({ name: c, spent: round(byCat[c] || 0), budget: budget.budgets[c] || null }))
    .filter((c) => c.spent || c.budget)
    .sort((a, b) => b.spent - a.spent);

  // Latest transaction per uploaded account, so you know when a new statement is due
  const latest = await kv(env).get("budget:latest", "json") || {};

  return json({
    ok: true,
    month,
    totals: {
      income: round(income), spent: round(spent), left: round(income - spent),
      budget: round(Object.values(budget.budgets).reduce((s, v) => s + (+v || 0), 0)),
      budgetSpent: round(Object.keys(budget.budgets).reduce((s, c) => s + Math.max(0, byCat[c] || 0), 0)),
    },
    categories,
    allCategories: CATEGORIES,
    transactions: list,
    accounts: accounts.map((a) => ({ ...a, balance: budget.balances[a.key] || null, latest: latest[a.key] || null })),
    monzo: { configured: monzoConfigured(env), ...monzo },
    goals: (await kv(env).get("budget:goals", "json")) || [],
    lastSync: budget.lastSync,
  });
}

async function importRows(request, env) {
  const body = await readJson(request);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return fail("No transactions found in that file.");
  if (rows.length > 10000) return fail("That file is too big — export a shorter date range.");

  const accounts = await getAccounts(env);
  let acct = body.account?.key ? accounts.find((a) => a.key === body.account.key) : null;
  if (!acct) {
    const bank = String(body.account?.bank || "").trim().slice(0, 30);
    const name = String(body.account?.name || "").trim().slice(0, 40);
    if (!bank || !name) return fail("Say which account this statement is for.");
    acct = { key: "up" + randomId(7), name, bank, source: "upload", mask: String(body.account?.mask || "").replace(/\D/g, "").slice(-4) };
    accounts.push(acct);
    await putAccounts(env, accounts);
  }

  const seen = {};
  const txs = [];
  let latest = "";
  for (const r of rows) {
    const date = String(r.date || "");
    const amount = Number(r.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFinite(amount) || amount === 0) continue;
    const k = `${date}|${amount}|${String(r.desc || "").toLowerCase().trim()}`;
    const seq = (seen[k] = (seen[k] ?? -1) + 1);         // two identical coffees on the same day stay as two
    txs.push(await makeTx(acct.key, { date, amount, desc: r.desc, note: r.note }, seq));
    if (date > latest) latest = date;
  }
  if (!txs.length) return fail("Couldn't read any transactions from that file.");
  // Re-uploading a statement replaces what an earlier upload of the same dates put there (so fixes to the reader take effect)
  const dates = txs.map((t) => t.date).sort();
  const cleared = await clearAccountRange(env, acct.key, dates[0], dates[dates.length - 1]);
  const added = Math.max(0, (await mergeTransactions(env, txs)) - cleared);

  const budget = await getBudget(env);
  if (isFinite(Number(body.balance)) && body.balance !== null && body.balance !== "") {
    budget.balances[acct.key] = { amount: Number(body.balance), at: new Date().toISOString(), asOf: latest };
    await putBudget(env, budget);
  }
  const latestMap = await kv(env).get("budget:latest", "json") || {};
  if (!latestMap[acct.key] || latest > latestMap[acct.key]) { latestMap[acct.key] = latest; await kv(env).put("budget:latest", JSON.stringify(latestMap)); }
  return json({ ok: true, account: acct.key, read: txs.length, added, skipped: txs.length - added });
}

async function setBudgets(request, env) {
  const { budgets } = await readJson(request);
  if (!budgets || typeof budgets !== "object") return fail("Missing budgets");
  const clean = {};
  for (const [k, v] of Object.entries(budgets)) {
    const n = parseFloat(v);
    if (CATEGORIES.includes(k) && n > 0 && n < 1e7) clean[k] = Math.round(n * 100) / 100;
  }
  const b = await getBudget(env);
  b.budgets = clean;
  await putBudget(env, b);
  return json({ ok: true });
}

async function setCategory(request, env) {
  const { id, month, cat, always } = await readJson(request);
  if (!CATEGORIES.includes(cat)) return fail("Unknown category");
  if (!/^\d{4}-\d{2}$/.test(month || "")) return fail("Bad month");
  const txs = await getMonth(env, month);
  const tx = txs.find((t) => t.id === id);
  if (!tx) return fail("Transaction not found", 404);
  const b = await getBudget(env);
  if (always) {
    const key = merchantKey(tx.desc);
    if (key) b.rules[key] = cat;
    for (const t of txs) if (merchantKey(t.desc) === key) delete b.overrides[t.id];
    if (!key) b.overrides[id] = cat;
  } else {
    b.overrides[id] = cat;
  }
  await putBudget(env, b);
  return json({ ok: true });
}

async function removeAccount(request, env, key) {
  const accounts = await getAccounts(env);
  const acct = accounts.find((a) => a.key === key);
  if (!acct) return fail("Not found", 404);
  await putAccounts(env, accounts.filter((a) => a.key !== key));
  if (acct.source === "monzo" && !accounts.some((a) => a.key !== key && a.source === "monzo")) await monzoDisconnect(env);
  if (new URL(request.url).searchParams.get("purge") === "1") await purgeAccount(env, key);
  return json({ ok: true });
}

async function addManual(request, env) {
  const { date, amount, desc, cat } = await readJson(request);
  const n = Math.round(Number(amount) * 100) / 100;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return fail("Pick a date");
  if (!isFinite(n) || n === 0 || Math.abs(n) > 1e6) return fail("Enter an amount");
  if (cat && !CATEGORIES.includes(cat)) return fail("Unknown category");
  const tx = await makeTx("manual", { date, amount: n, desc: String(desc || cat || "Spending").slice(0, 80), ref: "m" + randomId(8), cat: cat || null });
  await mergeTransactions(env, [tx]);
  return json({ ok: true, id: tx.id });
}

async function deleteManual(env, month, id) {
  if (!/^\d{4}-\d{2}$/.test(month)) return fail("Bad month");
  const txs = await getMonth(env, month);
  const t = txs.find((x) => x.id === id);
  if (!t) return fail("Not found", 404);
  if (t.acct !== "manual") return fail("Only things you added by hand can be deleted.");
  const keep = txs.filter((x) => x.id !== id);
  if (t.pair) for (const x of keep) if (x.pair === id) { delete x.pair; x.auto = undefined; }
  await putMonth(env, month, keep);
  return json({ ok: true });
}

async function setGoals(request, env) {
  const { goals } = await readJson(request);
  if (!Array.isArray(goals) || goals.length > 30) return fail("Bad goals");
  const clean = [];
  for (const g of goals) {
    const target = Math.round(Number(g.target) * 100) / 100;
    const saved = Math.max(0, Math.round(Number(g.saved || 0) * 100) / 100);
    const name = String(g.name || "").trim().slice(0, 40);
    if (!name || !(target > 0)) return fail("Each goal needs a name and a target");
    clean.push({
      id: /^[a-f0-9]{8,16}$/.test(g.id || "") ? g.id : randomId(6), name, target, saved,
      emoji: String(g.emoji || "🎯").slice(0, 4),
      due: /^\d{4}-\d{2}-\d{2}$/.test(g.due || "") ? g.due : null,
      history: Array.isArray(g.history) ? g.history.slice(-50).map((h) => ({ date: String(h.date).slice(0, 10), amount: Math.round(Number(h.amount) * 100) / 100 })) : [],
    });
  }
  await kv(env).put("budget:goals", JSON.stringify(clean));
  return json({ ok: true, goals: clean });
}

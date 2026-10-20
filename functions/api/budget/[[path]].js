// /api/budget/* — budget tracker (signed-in only; see _middleware.js).
//   GET    /api/budget/summary?month=YYYY-MM   totals, categories, transactions, banks
//   GET    /api/budget/banks                   UK banks you can connect
//   POST   /api/budget/connect   {bank}        -> { url } to sign in at the bank
//   POST   /api/budget/sync      {force?}      pull new transactions (at most every 6 h unless forced)
//   PUT    /api/budget/budgets   {budgets}     monthly limit per category
//   PUT    /api/budget/category  {id, month, cat, always}
//   DELETE /api/budget/connection/:id
import { json, fail, readJson, sameOrigin, kv } from "../../_lib/core.js";
import {
  bankingConfigured, eb, getConns, putConns, getBudget, putBudget, getMonth,
  syncAll, startConnect, categoryOf, merchantKey, CATEGORIES,
} from "../../_lib/banking.js";

const NOT_SET_UP = "Bank linking isn't set up yet — add EB_APP_ID and EB_PRIVATE_KEY in Cloudflare (see README).";

export async function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const route = parts[0] || "";
  const method = request.method;
  if (method !== "GET" && !sameOrigin(request)) return fail("Bad origin", 403);
  try {
    if (method === "GET" && route === "summary") return summary(request, env);
    if (method === "GET" && route === "banks") return banks(env);
    if (method === "POST" && route === "connect") return connect(request, env);
    if (method === "POST" && route === "sync") return sync(request, env);
    if (method === "PUT" && route === "budgets") return setBudgets(request, env);
    if (method === "PUT" && route === "category") return setCategory(request, env);
    if (method === "DELETE" && route === "connection" && parts[1]) return removeConnection(env, parts[1]);
    return fail("Not found", 404);
  } catch (e) {
    return fail(e.message || "Something went wrong", e.status && e.status < 500 ? 502 : 500);
  }
}

const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }).slice(0, 7);

async function summary(request, env) {
  let month = new URL(request.url).searchParams.get("month") || thisMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) month = thisMonth();
  const [conns, budget, txs] = await Promise.all([getConns(env), getBudget(env), getMonth(env, month)]);
  const acctName = {};
  for (const c of conns) for (const a of c.accounts) acctName[a.key] = `${c.bank} ${a.name}${a.mask ? ` ••${a.mask}` : ""}`;

  let income = 0, spent = 0;
  const byCat = {};
  const list = txs.map((t) => {
    const cat = categoryOf(t, budget);
    if (cat !== "Transfers") {
      if (cat === "Income" || (t.amount > 0 && cat === "Other")) income += t.amount;
      else { spent -= t.amount; byCat[cat] = (byCat[cat] || 0) - t.amount; }   // refunds in a category reduce it
    }
    return { id: t.id, date: t.date, amount: t.amount, desc: t.desc, note: t.note, cat, account: acctName[t.acct] || "Old account" };
  });

  const categories = CATEGORIES.filter((c) => !["Income", "Transfers"].includes(c))
    .map((c) => ({ name: c, spent: Math.round((byCat[c] || 0) * 100) / 100, budget: budget.budgets[c] || null }))
    .filter((c) => c.spent || c.budget)
    .sort((a, b) => b.spent - a.spent);

  return json({
    ok: true,
    configured: bankingConfigured(env),
    month,
    totals: {
      income: round(income), spent: round(spent), left: round(income - spent),
      budget: round(Object.values(budget.budgets).reduce((s, v) => s + (+v || 0), 0)),
      budgetSpent: round(Object.keys(budget.budgets).reduce((s, c) => s + Math.max(0, byCat[c] || 0), 0)),   // spending in categories that have a limit
    },
    categories,
    allCategories: CATEGORIES,
    transactions: list,
    connections: conns.map((c) => ({
      id: c.id, bank: c.bank, valid_until: c.valid_until,
      days_left: Math.floor((Date.parse(c.valid_until) - Date.now()) / 86400000),
      accounts: c.accounts.map((a) => ({ name: a.name, mask: a.mask, balance: budget.balances[a.key] || null })),
    })),
    lastSync: budget.lastSync,
  });
}
const round = (n) => Math.round(n * 100) / 100;

async function banks(env) {
  if (!bankingConfigured(env)) return fail(NOT_SET_UP, 503);
  const cached = await kv(env).get("bank:aspsps", "json");
  if (cached) return json({ ok: true, banks: cached });
  const r = await eb(env, "GET", "/aspsps?country=GB&psu_type=personal");
  const list = (r.aspsps || []).map((b) => b.name).sort((a, b) => a.localeCompare(b));
  await kv(env).put("bank:aspsps", JSON.stringify(list), { expirationTtl: 86400 });
  return json({ ok: true, banks: list });
}

async function connect(request, env) {
  if (!bankingConfigured(env)) return fail(NOT_SET_UP, 503);
  const { bank } = await readJson(request);
  if (!bank || typeof bank !== "string") return fail("Pick a bank");
  const url = await startConnect(env, new URL(request.url).origin, bank);
  return json({ ok: true, url });
}

async function sync(request, env) {
  if (!bankingConfigured(env)) return fail(NOT_SET_UP, 503);
  const { force } = await readJson(request);
  return json({ ok: true, ...(await syncAll(env, { force: !!force })) });
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
  const tx = (await getMonth(env, month)).find((t) => t.id === id);
  if (!tx) return fail("Transaction not found", 404);
  const b = await getBudget(env);
  if (always) {
    const key = merchantKey(tx.desc);
    if (key) b.rules[key] = cat;
    // a merchant rule replaces one-off choices for that merchant this month
    for (const t of await getMonth(env, month)) if (merchantKey(t.desc) === key) delete b.overrides[t.id];
  } else {
    b.overrides[id] = cat;
  }
  await putBudget(env, b);
  return json({ ok: true });
}

async function removeConnection(env, id) {
  const conns = await getConns(env);
  const c = conns.find((x) => x.id === id);
  if (!c) return fail("Not found", 404);
  try { await eb(env, "DELETE", `/sessions/${encodeURIComponent(c.session_id)}`); } catch { /* already gone at the bank */ }
  await putConns(env, conns.filter((x) => x.id !== id));
  return json({ ok: true });
}


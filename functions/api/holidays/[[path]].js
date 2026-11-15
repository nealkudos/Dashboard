// /api/holidays/* — holiday budgets (signed-in only; see _middleware.js).
//   GET    /api/holidays                       all holidays with totals
//   POST   /api/holidays                       {name, place, emoji, start, end, budget, currency, rate}
//   GET    /api/holidays/rate?from=AED&to=GBP  today's exchange rate
//   GET    /api/holidays/:id                   one holiday with its expenses
//   PUT    /api/holidays/:id                   change its details
//   DELETE /api/holidays/:id
//   POST   /api/holidays/:id/expenses          {date, amount, cur: "local"|"home", cat, note}
//   PUT    /api/holidays/:id/expenses/:eid     same fields
//   DELETE /api/holidays/:id/expenses/:eid
// Budgets and totals are in pounds; expenses can be entered in the local currency and are converted with the holiday's rate.
import { json, fail, readJson, sameOrigin, kv } from "../../_lib/core.js";
import { randomId } from "../../_lib/crypto.js";

export const CATS = ["Flights", "Hotel", "Food & drink", "Transport", "Activities", "Shopping", "Other"];
const INDEX = "hol:index";
const r2 = (n) => Math.round(n * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

const getIndex = async (env) => (await kv(env).get(INDEX, "json")) || [];
const getHol = (env, id) => kv(env).get(`hol:${id}`, "json");
async function putHol(env, h) {
  await kv(env).put(`hol:${h.id}`, JSON.stringify(h));
  const idx = (await getIndex(env)).filter((x) => x !== h.id);
  idx.push(h.id);
  await kv(env).put(INDEX, JSON.stringify(idx));
}

const homeAmount = (e, h) => r2(e.cur === "home" || !h.rate ? e.amount : e.amount * h.rate);

function withTotals(h, full = false) {
  const spent = r2(h.expenses.reduce((s, e) => s + homeAmount(e, h), 0));
  const byCat = {};
  for (const e of h.expenses) byCat[e.cat] = r2((byCat[e.cat] || 0) + homeAmount(e, h));
  const out = { ...h, spent, left: r2((h.budget || 0) - spent), byCat, count: h.expenses.length };
  if (full) out.expenses = h.expenses.map((e) => ({ ...e, home: homeAmount(e, h) })).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  else delete out.expenses;
  return out;
}

function cleanHoliday(b, old = {}) {
  const h = { ...old };
  if (b.name !== undefined) h.name = String(b.name || "").trim().slice(0, 50);
  if (b.place !== undefined) h.place = String(b.place || "").trim().slice(0, 60);
  if (b.emoji !== undefined) h.emoji = String(b.emoji || "🌴").slice(0, 4);
  if (b.start !== undefined) h.start = isDate(b.start) ? b.start : null;
  if (b.end !== undefined) h.end = isDate(b.end) ? b.end : null;
  if (b.budget !== undefined) h.budget = Math.max(0, r2(Number(b.budget) || 0));
  if (b.currency !== undefined) h.currency = /^[A-Z]{3}$/.test(String(b.currency || "").toUpperCase()) ? String(b.currency).toUpperCase() : "GBP";
  if (b.rate !== undefined) h.rate = Number(b.rate) > 0 && Number(b.rate) < 1000 ? Number(Number(b.rate).toPrecision(6)) : null;
  if (h.currency === "GBP") h.rate = 1;
  if (!h.name) throw new Error("Give the holiday a name");
  if (h.start && h.end && h.end < h.start) throw new Error("The end date is before the start date");
  return h;
}

function cleanExpense(b, old = {}) {
  const e = { ...old };
  const amt = r2(Number(b.amount));
  if (!(amt > 0) || amt > 1e7) throw new Error("Enter an amount");
  e.amount = amt;
  e.cur = b.cur === "home" ? "home" : "local";
  e.cat = CATS.includes(b.cat) ? b.cat : "Other";
  e.date = isDate(b.date) ? b.date : new Date().toISOString().slice(0, 10);
  e.note = String(b.note || "").trim().slice(0, 80);
  return e;
}

async function rate(env, from, to) {
  from = String(from || "").toUpperCase(); to = String(to || "GBP").toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new Error("Bad currency");
  if (from === to) return 1;
  const key = `fx:${from}`;
  let rates = await kv(env).get(key, "json");
  if (!rates) {
    let d = {};
    try { d = await (await fetch(`https://open.er-api.com/v6/latest/${from}`, { cf: { cacheTtl: 3600 } })).json(); } catch { /* offline */ }
    if (d.result !== "success") throw new Error("Couldn't get today's rate — type it in instead.");
    rates = d.rates;
    await kv(env).put(key, JSON.stringify(rates), { expirationTtl: 6 * 3600 });
  }
  if (!rates[to]) throw new Error(`No rate for ${from} to ${to}`);
  return rates[to];
}

export async function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const method = request.method;
  if (method !== "GET" && !sameOrigin(request)) return fail("Bad origin", 403);
  try {
    if (!parts.length) {
      if (method === "GET") {
        const hols = (await Promise.all((await getIndex(env)).map((id) => getHol(env, id)))).filter(Boolean);
        hols.sort((a, b) => (b.start || "").localeCompare(a.start || ""));
        return json({ ok: true, holidays: hols.map((h) => withTotals(h)), categories: CATS });
      }
      if (method === "POST") {
        const h = cleanHoliday(await readJson(request), { id: randomId(6), expenses: [], created: Date.now() });
        await putHol(env, h);
        return json({ ok: true, holiday: withTotals(h, true) });
      }
    }
    if (parts[0] === "rate" && method === "GET") {
      const u = new URL(request.url);
      return json({ ok: true, rate: await rate(env, u.searchParams.get("from"), u.searchParams.get("to") || "GBP") });
    }
    const id = parts[0];
    if (!/^[a-f0-9]{8,16}$/.test(id)) return fail("Not found", 404);
    const h = await getHol(env, id);
    if (!h) return fail("Holiday not found", 404);

    if (parts.length === 1) {
      if (method === "GET") return json({ ok: true, holiday: withTotals(h, true), categories: CATS });
      if (method === "PUT") { const n = cleanHoliday(await readJson(request), h); await putHol(env, n); return json({ ok: true, holiday: withTotals(n, true) }); }
      if (method === "DELETE") {
        await kv(env).delete(`hol:${id}`);
        await kv(env).put(INDEX, JSON.stringify((await getIndex(env)).filter((x) => x !== id)));
        return json({ ok: true });
      }
    }
    if (parts[1] === "expenses") {
      if (parts.length === 2 && method === "POST") {
        if (h.expenses.length >= 2000) return fail("That's a lot of expenses — start a new holiday.");
        h.expenses.push(cleanExpense(await readJson(request), { id: randomId(5), at: Date.now() }));
        await putHol(env, h);
        return json({ ok: true, holiday: withTotals(h, true) });
      }
      const i = h.expenses.findIndex((e) => e.id === parts[2]);
      if (i < 0) return fail("Expense not found", 404);
      if (method === "PUT") h.expenses[i] = cleanExpense(await readJson(request), h.expenses[i]);
      else if (method === "DELETE") h.expenses.splice(i, 1);
      else return fail("Not found", 404);
      await putHol(env, h);
      return json({ ok: true, holiday: withTotals(h, true) });
    }
    return fail("Not found", 404);
  } catch (e) {
    return fail(e.message || "Something went wrong", 400);
  }
}

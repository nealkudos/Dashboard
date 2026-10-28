// Budget tracker core: storage, categories, transfer matching and merging new transactions.
// Transactions arrive from Monzo (live, see monzo.js) or from statement uploads (CSV, parsed in the browser).
import { kv } from "./core.js";
import { sha256Hex } from "./crypto.js";

// ---------- Stored data ----------
// budget:accounts  [{ key, name, bank, source:"monzo"|"upload", mask }]
// bt:YYYY-MM       transactions for that month: [{ id, acct, date, amount, desc, note?, auto, pair? }]
// budget           { budgets:{cat:amount}, rules:{merchantKey:cat}, overrides:{txId:cat}, balances:{acctKey:{amount,at}}, lastSync }
export const getAccounts = async (env) => (await kv(env).get("budget:accounts", "json")) || [];
export const putAccounts = (env, a) => kv(env).put("budget:accounts", JSON.stringify(a));
export const getBudget = async (env) => ({ budgets: {}, rules: {}, overrides: {}, balances: {}, lastSync: null, ...((await kv(env).get("budget", "json")) || {}) });
export const putBudget = (env, b) => kv(env).put("budget", JSON.stringify(b));
export const getMonth = async (env, ym) => (await kv(env).get(`bt:${ym}`, "json")) || [];
export const putMonth = (env, ym, list) => kv(env).put(`bt:${ym}`, JSON.stringify(list));

// ---------- Categories ----------
export const CATEGORIES = [
  "Groceries", "Eating out", "Transport", "Fuel", "Bills", "Housing", "Subscriptions", "Shopping",
  "Health", "Family", "Entertainment", "Travel", "Cash", "Fees", "Other", "Income", "Transfers",
];

const RULES = [
  ["Income", /\b(salary|wages|payroll|kudos|dividend|interest paid|hmrc|tax refund|bgc|bank giro credit)\b/i],
  ["Transfers", /\b(monzo|amex|american express|nationwide (credit )?card|card payment received|payment received|thank you for your payment|transfer (to|from)|to savings|from savings|pot transfer|savings pot)\b/i],
  ["Groceries", /\b(tesco|sainsbury|asda|aldi|lidl|morrisons|waitrose|co-?op|ocado|iceland|m&s food|marks ?& ?spencer simply food|budgens|costco)\b/i],
  ["Eating out", /\b(mcdonald|kfc|nando|greggs|pret|starbucks|costa|caffe nero|deliveroo|just eat|uber ?eats|domino|pizza|burger|restaurant|cafe|wagamama|five guys|subway|leon|itsu|wasabi)\b/i],
  ["Transport", /\b(tfl|transport for london|trainline|gwr|great western|elizabeth line|uber(?! ?eats)|bolt|addison lee|parking|ringgo|paybyphone|congestion|ulez|dart charge|national rail|avanti|lner)\b/i],
  ["Fuel", /\b(shell|bp |esso|texaco|jet |gulf|murco|petrol|fuel|tesla supercharger)\b/i],
  ["Bills", /\b(british gas|octopus|edf|e\.?on|ovo|thames water|affinity water|council tax|council|tv licen[cs]e|bt group|virgin media|sky |vodafone|ee limited|three|o2 |giffgaff|insurance|aviva|admiral|direct line)\b/i],
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
  return tx.amount > 0 ? "Transfers" : "Other";   // money in that isn't pay is a transfer until you say otherwise
}

// Money moving between your own accounts (e.g. "Payment to NEAL CHAUHAN") is never spending or income
const SELF = /\b(neal\s+a?\s*chauhan|n\s*a\s+chauhan|mr\s+n\s+(a\s+)?chauhan|chauhan\s+n(eal)?)\b/i;
const looksLikeSelf = (tx) => SELF.test(`${tx.desc || ""} ${tx.note || ""}`);
const looksLikePay = (tx) => tx.amount > 0 && RULES[0][1].test(`${tx.desc || ""} ${tx.note || ""}`);

export function categoryOf(tx, budget) {
  const chosen = budget.overrides[tx.id] || budget.rules[merchantKey(tx.desc)];
  if (chosen) return chosen;                                   // you picked it: always wins
  if (looksLikePay(tx)) return "Income";
  if (looksLikeSelf(tx)) return "Transfers";
  const auto = tx.auto || autoCategory(tx);
  // Only pay counts as income automatically; any other money in (transfers, cash paid in) is a transfer
  return auto === "Income" && tx.acct !== "manual" ? "Transfers" : auto;
}

export function markTransfers(list) {
  for (const a of list) {
    if (a.amount >= 0 || a.pair) continue;
    const b = list.find((x) => !x.pair && x.amount > 0 && !looksLikePay(x) && x.acct !== a.acct && Math.abs(x.amount + a.amount) < 0.005 &&
      Math.abs(Date.parse(x.date) - Date.parse(a.date)) <= 3 * 86400000);
    if (b) { a.pair = b.id; b.pair = a.id; a.auto = b.auto = "Transfers"; }
  }
  return list;
}

// ---------- Building and merging transactions ----------
/** Make a stored transaction. `seq` separates genuinely identical rows (same day, amount and text). */
export async function makeTx(acctKey, { date, amount, desc, note, mcc, ref, cat }, seq = 0) {
  const clean = String(desc || "Transaction").replace(/\s+/g, " ").trim().slice(0, 120);
  const amt = Math.round(Number(amount) * 100) / 100;
  const id = (await sha256Hex(`${acctKey}|${ref || `${date}|${amt}|${clean.toLowerCase()}|${seq}`}`)).slice(0, 20);
  const tx = { id, acct: acctKey, date, amount: amt, desc: clean };
  if (note && note !== clean) tx.note = String(note).slice(0, 120);
  if (mcc) tx.mcc = mcc;
  tx.auto = cat || autoCategory(tx);
  return tx;
}

/** Add transactions to their month buckets (skipping ones already stored), then pair up transfers. */
export async function mergeTransactions(env, fresh) {
  const months = {};
  const load = async (ym) => (months[ym] ||= await getMonth(env, ym));
  const touched = new Set();
  let added = 0;
  for (const t of fresh) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) continue;
    const ym = t.date.slice(0, 7);
    const list = await load(ym);
    const live = t.live;
    delete t.live;
    const old = list.find((x) => x.id === t.id);
    if (!old) { list.push(t); added++; touched.add(ym); }
    else if (live && (old.amount !== t.amount || old.desc !== t.desc)) {
      old.amount = t.amount; old.desc = t.desc; touched.add(ym);   // live data can change (e.g. pending -> settled)
    }
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
  return added;
}

/** Remove an account and every transaction it brought in; anything it was paired with as a transfer is un-paired. */
export async function purgeAccount(env, key) {
  const accounts = await getAccounts(env);
  await putAccounts(env, accounts.filter((a) => a.key !== key));
  const list = await kv(env).list({ prefix: "bt:" });
  let removed = 0;
  for (const k of list.keys) {
    const txs = (await kv(env).get(k.name, "json")) || [];
    const keep = txs.filter((t) => t.acct !== key);
    if (keep.length !== txs.length) { removed += txs.length - keep.length; await putMonth(env, k.name.slice(3), keep); }
  }
  await unpairOrphans(env);
  const b = await getBudget(env);
  if (b.balances[key]) { delete b.balances[key]; await putBudget(env, b); }
  const latest = (await kv(env).get("budget:latest", "json")) || {};
  if (latest[key]) { delete latest[key]; await kv(env).put("budget:latest", JSON.stringify(latest)); }
  return removed;
}

/** Pairs can span neighbouring months: drop any transfer pair that now points at nothing. */
async function unpairOrphans(env) {
  const list = await kv(env).list({ prefix: "bt:" });
  const ids = new Set();
  const months = {};
  for (const k of list.keys) { months[k.name] = (await kv(env).get(k.name, "json")) || []; months[k.name].forEach((t) => ids.add(t.id)); }
  for (const [name, txs] of Object.entries(months)) {
    let changed = false;
    for (const t of txs) if (t.pair && !ids.has(t.pair)) { delete t.pair; t.auto = autoCategory(t); changed = true; }
    if (changed) await putMonth(env, name.slice(3), txs);
  }
}

/** A statement is the full record for its dates: clear what an earlier upload put there for this account before re-adding. */
export async function clearAccountRange(env, key, from, to) {
  let removed = 0;
  const [y0, m0] = from.split("-").map(Number);
  const [y1, m1] = to.split("-").map(Number);
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    const txs = await getMonth(env, ym);
    const keep = txs.filter((t) => !(t.acct === key && t.date >= from && t.date <= to));
    if (keep.length !== txs.length) { removed += txs.length - keep.length; await putMonth(env, ym, keep); }
  }
  if (removed) await unpairOrphans(env);
  return removed;
}

// ---------- Budget months: calendar, or payday to payday ----------
// With a payday set (e.g. 28), "October" runs from the day September's pay lands to the day before October's pay lands
// (paydays after the 15th name the month by where it ends; earlier paydays by where it starts). The edges follow the
// real salary date when it came a few days early (weekends, bank holidays) or late.
const addMonths = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const isoDay = (ym, day) => { const [y, m] = ym.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${ym}-${String(Math.min(day, last)).padStart(2, "0")}`; };
const shiftDay = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Dates salary arrived (pay-looking income of £300+, e.g. "Bank credit KUDOS AV"), oldest first. */
export function payDates(txs) {
  return [...new Set(txs.filter((t) => t.amount >= 300 && looksLikePay(t)).map((t) => t.date))].sort();
}

/** The payday to use: the one you set, or worked out from when salary has been landing (0 = calendar months). */
export function effectivePayday(budget, pays) {
  if (Number.isInteger(budget.payday)) return budget.payday;
  const days = pays.slice(-6).map((d) => +d.slice(8, 10)).sort((a, b) => a - b);
  return days.length >= 2 ? days[Math.floor(days.length / 2)] : 0;
}

function edge(label, payday, pays) {
  const nominal = isoDay(payday > 15 ? addMonths(label, -1) : label, payday);
  const near = pays.filter((d) => d >= shiftDay(nominal, -7) && d <= shiftDay(nominal, 3));
  return near[0] || nominal;
}

/** { label, start, end } — end is exclusive. */
export function periodFor(label, payday, pays) {
  if (!payday) return { label, start: `${label}-01`, end: `${addMonths(label, 1)}-01` };
  return { label, start: edge(label, payday, pays), end: edge(addMonths(label, 1), payday, pays) };
}

export function labelFor(date, payday, pays) {
  const cal = date.slice(0, 7);
  for (const l of [addMonths(cal, -1), cal, addMonths(cal, 1)]) {
    const p = periodFor(l, payday, pays);
    if (date >= p.start && date < p.end) return l;
  }
  return cal;
}
export { addMonths };

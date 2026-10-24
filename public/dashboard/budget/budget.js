// Budget app: Home, Calendar, Budgets, Savings, quick add. Data: Monzo (live), statement uploads, things you add by hand.
import { PRESETS, readStatement } from "./statements.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gbp = (n, sign = false) => (sign && n > 0 ? "+" : n < 0 ? "−" : "") + "£" + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gbp0 = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 });
const short = (n) => Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1).replace(/\.0$/, "")}k` : Math.round(Math.abs(n)).toString();
const todayStr = () => new Date().toLocaleDateString("en-CA");
const thisMonth = () => todayStr().slice(0, 7);
const fmtDay = (d, opts = { weekday: "short", day: "numeric", month: "short" }) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", opts);

const ICON = {
  Groceries: "🛒", "Eating out": "🍽️", Transport: "🚆", Fuel: "⛽", Bills: "🧾", Housing: "🏠", Subscriptions: "🔁",
  Shopping: "🛍️", Health: "💊", Family: "👨‍👩‍👧", Entertainment: "🎬", Travel: "✈️", Cash: "💷", Fees: "🏦", Other: "•",
  Income: "💰", Transfers: "↔️",
};
const icon = (c) => ICON[c] || "•";
const SPEND_CATS = Object.keys(ICON).filter((c) => !["Income", "Transfers"].includes(c));

let month = new URLSearchParams(location.search).get("month") || thisMonth();
let view = "home";
let data = null;
let selDay = null;
let catFilter = "";

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: opts.body ? { "content-type": "application/json" } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { location.replace("/"); throw new Error("Signed out"); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error || `Error ${res.status}`);
  return d;
}
let msgTimer;
function showErr(m) { $("err").textContent = m || ""; $("err").hidden = !m; }
function showOk(m, keep) {
  $("okmsg").textContent = m || ""; $("okmsg").hidden = !m;
  clearTimeout(msgTimer); if (m && !keep) msgTimer = setTimeout(() => ($("okmsg").hidden = true), 5000);
}

// ---------- Navigation ----------
function go(v) {
  view = v;
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.dataset.view !== v));
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === v || (v === "all" && b.dataset.tab === "home")));
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tabbar button").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));

function shiftMonth(d) {
  const [y, m] = month.split("-").map(Number);
  month = new Date(y, m - 1 + d, 1).toLocaleDateString("en-CA").slice(0, 7);
  selDay = null;
  history.replaceState(null, "", month === thisMonth() ? location.pathname : `?month=${month}`);
  load();
}
$("prev").onclick = () => shiftMonth(-1);
$("next").onclick = () => shiftMonth(1);

async function load() {
  const [y, m] = month.split("-").map(Number);
  $("month").textContent = new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  $("next").disabled = month >= thisMonth();
  try {
    data = await api(`/api/budget/summary?month=${month}`);
    drawAll();
  } catch (e) { showErr(e.message); }
}

function drawAll() {
  drawHome(); drawCalendar(); drawBudgets(); drawSavings(); drawAll_();
}

// ---------- Shared bits ----------
function txRow(t, { showDate = false } = {}) {
  const meta = [showDate ? fmtDay(t.date, { day: "numeric", month: "short" }) : "", t.cat, t.account].filter(Boolean).join(" · ");
  return `<div class="tx${t.cat === "Transfers" ? " transfer" : ""}" data-id="${esc(t.id)}">
    <div class="ico">${icon(t.cat)}</div>
    <div class="mid"><div class="d">${esc(t.desc)}</div><div class="m">${esc(meta)}</div></div>
    <div class="a ${t.amount > 0 ? "up" : ""}">${gbp(t.amount, true)}</div></div>`;
}
function bindRows(root) {
  root.querySelectorAll(".tx[data-id]").forEach((r) => (r.onclick = () => txSheet(data.transactions.find((t) => t.id === r.dataset.id))));
}
const daysLeftInMonth = () => {
  if (month !== thisMonth()) return month < thisMonth() ? 0 : null;
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate() - new Date().getDate() + 1;
};

// ---------- Home ----------
function drawHome() {
  const t = data.totals;
  $("h-left").textContent = gbp(t.left);
  $("h-left").className = "big " + (t.left < 0 ? "down" : "");
  $("h-in").textContent = gbp(t.income);
  $("h-out").textContent = gbp(t.spent);

  // things that need you
  const alerts = [];
  if (!data.accounts.length && !data.transactions.length) alerts.push(["👋", "Connect Monzo or upload a statement to get started", "Set up", openSettings]);
  if (data.monzo.connected && data.monzo.waiting) alerts.push(["📱", "Monzo is waiting for you to approve access in the app", "Check", () => sync(true)]);
  for (const a of data.accounts.filter((a) => a.source === "upload" && a.latest)) {
    const age = Math.round((Date.parse(todayStr()) - Date.parse(a.latest)) / 86400000);
    if (age > 10) alerts.push(["📄", `${a.bank} ${a.name.toLowerCase()} is up to ${fmtDay(a.latest, { day: "numeric", month: "short" })}`, "Upload", () => upload(a.key)]);
  }
  $("h-alerts").innerHTML = alerts.map(([e, m, b], i) => `<div class="alert"><span>${e}</span><span>${esc(m)}</span><button type="button" data-a="${i}">${b}</button></div>`).join("");
  $("h-alerts").querySelectorAll("[data-a]").forEach((b) => (b.onclick = alerts[b.dataset.a][3]));

  const spending = data.transactions;
  $("h-recent").innerHTML = spending.slice(0, 5).map((t) => txRow(t, { showDate: true })).join("") || `<div class="empty">Nothing yet this month. Tap ＋ to add something.</div>`;
  $("h-count").textContent = spending.length > 5 ? `(${spending.length})` : "";
  bindRows($("h-recent"));

  const buds = data.categories.filter((c) => c.budget).slice(0, 3);
  $("h-budgets").innerHTML = buds.map(budRow).join("") || `<div class="empty">No budgets yet. <button class="link" type="button" id="h-setb">Set some</button></div>`;
  $("h-setb")?.addEventListener("click", editBudgets);

  const goals = data.goals.slice(0, 2);
  $("h-goals").innerHTML = goals.map((g) => {
    const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
    return `<div class="bud"><div class="row"><div class="ico">${esc(g.emoji)}</div><div class="nm">${esc(g.name)}</div>
      <div class="amt">${gbp0(g.saved)}<small>of ${gbp0(g.target)}</small></div></div>
      <div class="meter"><i style="width:${pct}%;background:var(--ok)"></i></div></div>`;
  }).join("") || `<div class="empty">No savings goals yet. <button class="link" type="button" id="h-newg">Add one</button></div>`;
  $("h-newg")?.addEventListener("click", () => goalSheet());
}

function budRow(c) {
  const left = c.budget - c.spent;
  const pct = Math.min(100, (c.spent / c.budget) * 100);
  const cls = c.spent > c.budget ? "over" : c.spent > c.budget * 0.85 ? "warn" : "";
  const dl = daysLeftInMonth();
  let sub = left >= 0 ? `${gbp(left)} left` : `${gbp(-left)} over`;
  if (dl) sub += ` · ${dl} day${dl === 1 ? "" : "s"} to go${left > 0 ? ` · about ${gbp0(left / dl)}/day` : ""}`;
  return `<div class="bud"><div class="row"><div class="ico">${icon(c.name)}</div><div class="nm">${esc(c.name)}</div>
    <div class="amt">${gbp(c.spent)}<small>of ${gbp0(c.budget)}</small></div></div>
    <div class="meter"><i class="${cls}" style="width:${pct}%"></i></div>
    <div class="sub ${left < 0 ? "down" : ""}">${sub}</div></div>`;
}

// ---------- Calendar ----------
function drawCalendar() {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;            // Monday first
  const byDay = {};
  for (const t of data.transactions) {
    if (t.cat === "Transfers") continue;
    const d = (byDay[t.date] ||= { in: 0, out: 0 });
    if (t.amount > 0 && (t.cat === "Income" || t.cat === "Other")) d.in += t.amount; else d.out -= t.amount;
  }
  const maxOut = Math.max(1, ...Object.values(byDay).map((d) => d.out));
  if (!selDay || selDay.slice(0, 7) !== month) selDay = month === thisMonth() ? todayStr() : `${month}-01`;

  let html = "";
  for (let i = 0; i < lead; i++) html += `<button class="out" disabled></button>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${month}-${String(d).padStart(2, "0")}`;
    const v = byDay[ds];
    html += `<button type="button" data-d="${ds}" class="${ds === todayStr() ? "today" : ""} ${ds === selDay ? "sel" : ""}">
      <span>${d}</span>${v?.in ? `<span class="ci">+${short(v.in)}</span>` : ""}${v?.out > 0.5 ? `<span class="co">−${short(v.out)}</span>` : ""}
      ${v?.out > 0.5 ? `<span class="heat" style="opacity:${0.25 + 0.75 * Math.min(1, v.out / maxOut)}"></span>` : ""}</button>`;
  }
  $("cal").innerHTML = html;
  $("cal").querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => { selDay = b.dataset.d; drawCalendar(); }));
  $("c-in").textContent = gbp(data.totals.income);
  $("c-out").textContent = gbp(data.totals.spent);

  const list = data.transactions.filter((t) => t.date === selDay);
  const v = byDay[selDay] || { in: 0, out: 0 };
  $("c-day-h").textContent = fmtDay(selDay, { weekday: "long", day: "numeric", month: "long" });
  $("c-day-t").innerHTML = [v.in ? `<span class="up">+${gbp(v.in)}</span>` : "", v.out > 0.005 ? `−${gbp(v.out)}` : ""].filter(Boolean).join(" · ");
  $("c-day").innerHTML = list.map((t) => txRow(t)).join("") || `<div class="empty">Nothing on this day.</div>`;
  bindRows($("c-day"));
}

// ---------- Budgets ----------
function drawBudgets() {
  const t = data.totals;
  if (t.budget) {
    const pct = Math.round((t.budgetSpent / t.budget) * 100);
    $("b-used").textContent = `${pct}%`;
    $("b-used").className = "big " + (pct > 100 ? "down" : pct > 85 ? "warn-t" : "up");
    const dl = daysLeftInMonth();
    $("b-sub").textContent = `${gbp(t.budgetSpent)} of ${gbp(t.budget)}${dl ? ` · ${dl} days left` : ""}`;
  } else { $("b-used").textContent = "–"; $("b-used").className = "big"; $("b-sub").textContent = "Set a monthly limit for the things you want to keep an eye on."; }
  const buds = data.categories.filter((c) => c.budget);
  $("b-list").innerHTML = buds.map(budRow).join("") || `<div class="empty">No budgets yet — tap Edit.</div>`;
  const other = data.categories.filter((c) => !c.budget && c.spent);
  $("b-other-card").hidden = !other.length;
  $("b-other").innerHTML = other.map((c) => `<div class="tx" data-cat="${esc(c.name)}"><div class="ico">${icon(c.name)}</div>
    <div class="mid"><div class="d">${esc(c.name)}</div></div><div class="a">${gbp(c.spent)}</div></div>`).join("");
  $("b-other").querySelectorAll("[data-cat]").forEach((r) => (r.onclick = () => { catFilter = r.dataset.cat; $("f-cat").value = catFilter; drawAll_(); go("all"); }));
}
$("edit-budgets").onclick = editBudgets;

function editBudgets() {
  const d = $("dlg");
  const current = Object.fromEntries(data.categories.filter((c) => c.budget).map((c) => [c.name, c.budget]));
  d.innerHTML = `<h3>Monthly budgets</h3><div class="muted small">Leave blank for no limit.</div>
    <form id="bf" style="margin-top:8px">${SPEND_CATS.map((c) => `<div class="brow"><div class="ico">${icon(c)}</div><span class="n">${esc(c)}</span>
      <input type="text" inputmode="decimal" name="${esc(c)}" value="${current[c] ?? ""}" placeholder="£"></div>`).join("")}
    <div class="actions"><button class="ghost" type="button" id="x">Cancel</button><button type="submit">Save</button></div></form>`;
  d.querySelector("#x").onclick = () => d.close();
  d.querySelector("#bf").onsubmit = async (e) => {
    e.preventDefault();
    const budgets = {};
    for (const c of SPEND_CATS) { const v = e.target.elements[c].value.replace(/[£,\s]/g, ""); if (v) budgets[c] = v; }
    try { await api("/api/budget/budgets", { method: "PUT", body: { budgets } }); d.close(); load(); } catch (err) { showErr(err.message); }
  };
  d.showModal();
}

// ---------- Savings ----------
function drawSavings() {
  const goals = data.goals;
  const total = goals.reduce((s, g) => s + g.saved, 0), target = goals.reduce((s, g) => s + g.target, 0);
  $("s-total").textContent = gbp(total);
  $("s-sub").textContent = goals.length ? `towards ${gbp0(target)} across ${goals.length} goal${goals.length === 1 ? "" : "s"}` : "Add a goal — a holiday, a car, a rainy-day fund.";
  $("s-list").innerHTML = goals.map((g, i) => {
    const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
    let due = "";
    if (g.due && g.saved < g.target) {
      const months = Math.max(1, (new Date(g.due + "T12:00:00").getFullYear() - new Date().getFullYear()) * 12 + new Date(g.due + "T12:00:00").getMonth() - new Date().getMonth());
      due = `${gbp0((g.target - g.saved) / months)}/month to hit ${fmtDay(g.due, { month: "short", year: "numeric" })}`;
    }
    return `<div class="goal"><div class="row"><div class="ico">${esc(g.emoji)}</div><div class="nm">${esc(g.name)}</div>
        <div class="pct ${pct >= 100 ? "up" : ""}">${pct}%</div></div>
      <div class="meter"><i style="width:${pct}%;background:var(--ok)"></i></div>
      <div class="meta"><span>${gbp(g.saved)} of ${gbp0(g.target)}</span><span>${pct >= 100 ? "Done 🎉" : `${gbp0(g.target - g.saved)} to go`}</span></div>
      ${due ? `<div class="meta" style="margin-top:2px"><span>${esc(due)}</span></div>` : ""}
      <div class="acts"><button type="button" data-add="${i}">＋ Add money</button><button class="ghost" type="button" data-take="${i}">Take out</button><button class="ghost" type="button" data-edit="${i}" style="flex:none">Edit</button></div></div>`;
  }).join("");
  $("s-list").querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => moneySheet(+b.dataset.add, 1)));
  $("s-list").querySelectorAll("[data-take]").forEach((b) => (b.onclick = () => moneySheet(+b.dataset.take, -1)));
  $("s-list").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => goalSheet(+b.dataset.edit)));
}
$("new-goal").onclick = () => goalSheet();

async function saveGoals(goals) {
  const r = await api("/api/budget/goals", { method: "PUT", body: { goals } });
  data.goals = r.goals;
  drawSavings(); drawHome();
}

const EMOJIS = ["🎯", "✈️", "🏠", "🚗", "💍", "🎁", "🛟", "👶", "🎓", "💻", "🏖️", "📈"];
function goalSheet(i) {
  const g = i === undefined ? { name: "", target: "", saved: 0, emoji: "🎯", due: "" } : { ...data.goals[i] };
  const d = $("dlg");
  d.innerHTML = `<h3>${i === undefined ? "New savings goal" : "Edit goal"}</h3>
    <label class="fld"><span>Name</span><input type="text" id="g-name" maxlength="40" placeholder="e.g. Holiday" value="${esc(g.name)}"></label>
    <div class="fld"><span>Icon</span><div class="emoji-row">${EMOJIS.map((e) => `<button type="button" class="${e === g.emoji ? "on" : ""}">${e}</button>`).join("")}</div></div>
    <label class="fld"><span>Target</span><input type="text" inputmode="decimal" id="g-target" placeholder="£" value="${g.target}"></label>
    ${i === undefined ? `<label class="fld"><span>Already saved (optional)</span><input type="text" inputmode="decimal" id="g-saved" placeholder="£0"></label>` : ""}
    <label class="fld"><span>Target date (optional)</span><input type="date" id="g-due" value="${g.due || ""}"></label>
    <div class="actions">${i !== undefined ? `<button class="ghost grow" type="button" id="g-del" style="color:var(--danger)">Delete</button>` : ""}
      <button class="ghost" type="button" id="x">Cancel</button><button type="button" id="g-save">Save</button></div>`;
  let emoji = g.emoji;
  d.querySelectorAll(".emoji-row button").forEach((b) => (b.onclick = () => {
    emoji = b.textContent; d.querySelectorAll(".emoji-row button").forEach((x) => x.classList.toggle("on", x === b));
  }));
  d.querySelector("#x").onclick = () => d.close();
  d.querySelector("#g-del")?.addEventListener("click", async () => {
    if (!confirm(`Delete "${g.name}"?`)) return;
    try { await saveGoals(data.goals.filter((_, k) => k !== i)); d.close(); } catch (e) { showErr(e.message); }
  });
  d.querySelector("#g-save").onclick = async () => {
    const goal = { ...g, emoji, name: d.querySelector("#g-name").value, target: d.querySelector("#g-target").value.replace(/[£,\s]/g, ""),
      due: d.querySelector("#g-due").value || null };
    if (i === undefined) {
      const s = Number((d.querySelector("#g-saved").value || "0").replace(/[£,\s]/g, "")) || 0;
      goal.saved = s; goal.history = s ? [{ date: todayStr(), amount: s }] : [];
    }
    const goals = [...data.goals];
    if (i === undefined) goals.push(goal); else goals[i] = goal;
    try { await saveGoals(goals); d.close(); } catch (e) { alert(e.message); }
  };
  d.showModal();
  if (i === undefined) d.querySelector("#g-name").focus();
}

function moneySheet(i, dir) {
  const g = data.goals[i];
  const d = $("dlg");
  d.innerHTML = `<h3>${dir > 0 ? "Add to" : "Take from"} ${esc(g.emoji)} ${esc(g.name)}</h3>
    <div class="muted small">${gbp(g.saved)} saved of ${gbp0(g.target)}</div>
    <input type="text" inputmode="decimal" class="amount-in fld" id="m-amt" placeholder="£0">
    <div class="actions"><button class="ghost" type="button" id="x">Cancel</button><button type="button" id="m-ok">${dir > 0 ? "Add" : "Take out"}</button></div>`;
  d.querySelector("#x").onclick = () => d.close();
  d.querySelector("#m-ok").onclick = async () => {
    const amt = Number(d.querySelector("#m-amt").value.replace(/[£,\s]/g, ""));
    if (!(amt > 0)) return;
    const goals = data.goals.map((x, k) => k !== i ? x : {
      ...x, saved: Math.max(0, x.saved + dir * amt), history: [...(x.history || []), { date: todayStr(), amount: dir * amt }],
    });
    try {
      await saveGoals(goals); d.close();
      const ng = data.goals[i];
      if (dir > 0 && ng.saved >= ng.target && g.saved < g.target) showOk(`🎉 You've reached your ${ng.name} goal!`);
    } catch (e) { alert(e.message); }
  };
  d.showModal();
  d.querySelector("#m-amt").focus();
}

// ---------- All transactions ----------
function drawAll_() {
  const sel = $("f-cat");
  if (sel.options.length <= 1) sel.insertAdjacentHTML("beforeend", data.allCategories.map((c) => `<option>${esc(c)}</option>`).join(""));
  sel.value = catFilter;
  const q = $("q").value.trim().toLowerCase();
  const list = data.transactions.filter((t) => (!catFilter || t.cat === catFilter) && (!q || `${t.desc} ${t.note || ""} ${t.account}`.toLowerCase().includes(q)));
  let html = "", day = "";
  for (const t of list) {
    if (t.date !== day) { day = t.date; html += `<div class="day">${fmtDay(day)}</div>`; }
    html += txRow(t);
  }
  $("txs").innerHTML = html || `<div class="empty">${data.transactions.length ? "Nothing matches." : "No transactions this month."}</div>`;
  bindRows($("txs"));
}
$("q").oninput = drawAll_;
$("f-cat").onchange = () => { catFilter = $("f-cat").value; drawAll_(); };

// ---------- One transaction ----------
function txSheet(t) {
  const d = $("dlg");
  d.innerHTML = `<div class="row" style="display:flex;gap:12px;align-items:center"><div class="ico">${icon(t.cat)}</div>
      <div style="flex:1;min-width:0"><h3 style="margin:0">${esc(t.desc)}</h3><div class="muted small">${fmtDay(t.date, { weekday: "long", day: "numeric", month: "long" })} · ${esc(t.account)}</div></div>
      <div style="font-weight:700;font-size:20px" class="${t.amount > 0 ? "up" : ""}">${gbp(t.amount, true)}</div></div>
    ${t.note ? `<div class="muted small" style="margin-top:8px">${esc(t.note)}</div>` : ""}
    <div class="fld"><span>Category</span><div class="chips">${data.allCategories.map((c) => `<button type="button" data-c="${esc(c)}" class="${c === t.cat ? "on" : ""}"><span>${icon(c)}</span>${esc(c)}</button>`).join("")}</div></div>
    ${t.manual ? "" : `<label class="chk"><input type="checkbox" id="always" checked> Always use this for “${esc(t.desc.slice(0, 30))}”</label>`}
    <div class="actions">${t.manual ? `<button class="ghost grow" type="button" id="t-del" style="color:var(--danger)">Delete</button>` : ""}<button class="ghost" type="button" id="x">Close</button></div>`;
  d.querySelector("#x").onclick = () => d.close();
  d.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => {
    try {
      await api("/api/budget/category", { method: "PUT", body: { id: t.id, month: t.date.slice(0, 7), cat: b.dataset.c, always: !!d.querySelector("#always")?.checked } });
      d.close(); load();
    } catch (e) { d.close(); showErr(e.message); }
  }));
  d.querySelector("#t-del")?.addEventListener("click", async () => {
    try { await api(`/api/budget/tx/${t.date.slice(0, 7)}/${t.id}`, { method: "DELETE" }); d.close(); load(); } catch (e) { d.close(); showErr(e.message); }
  });
  d.showModal();
}

// ---------- Quick add ----------
$("add").onclick = () => {
  const d = $("dlg");
  let dir = -1, cat = "Eating out";
  const defDate = month === thisMonth() ? todayStr() : (selDay || `${month}-01`);
  d.innerHTML = `<h3>Add</h3>
    <div class="seg2"><button type="button" class="on" data-dir="-1">Spent</button><button type="button" data-dir="1">Received</button></div>
    <input type="text" inputmode="decimal" class="amount-in fld" id="a-amt" placeholder="£0.00" autocomplete="off">
    <div class="fld"><span>Category</span><div class="chips" id="a-cats"></div></div>
    <label class="fld"><span>What was it? (optional)</span><input type="text" id="a-desc" maxlength="80" placeholder="e.g. Coffee with Khush"></label>
    <label class="fld"><span>Date</span><input type="date" id="a-date" value="${defDate}" max="${todayStr()}"></label>
    <div class="actions"><button class="ghost" type="button" id="x">Cancel</button><button type="button" id="a-ok">Add</button></div>`;
  const drawCats = () => {
    const list = dir < 0 ? SPEND_CATS : ["Income", "Other"];
    if (!list.includes(cat)) cat = list[0];
    d.querySelector("#a-cats").innerHTML = list.map((c) => `<button type="button" data-c="${esc(c)}" class="${c === cat ? "on" : ""}"><span>${icon(c)}</span>${esc(c)}</button>`).join("");
    d.querySelectorAll("#a-cats [data-c]").forEach((b) => (b.onclick = () => { cat = b.dataset.c; drawCats(); }));
  };
  d.querySelectorAll("[data-dir]").forEach((b) => (b.onclick = () => {
    dir = +b.dataset.dir; d.querySelectorAll("[data-dir]").forEach((x) => x.classList.toggle("on", x === b)); drawCats();
  }));
  drawCats();
  d.querySelector("#x").onclick = () => d.close();
  d.querySelector("#a-ok").onclick = async () => {
    const amt = Number(d.querySelector("#a-amt").value.replace(/[£,\s]/g, ""));
    if (!(amt > 0)) { d.querySelector("#a-amt").focus(); return; }
    const date = d.querySelector("#a-date").value || todayStr();
    try {
      await api("/api/budget/tx", { method: "POST", body: { date, amount: dir * amt, cat, desc: d.querySelector("#a-desc").value.trim() || cat } });
      d.close();
      if (date.slice(0, 7) !== month) { month = date.slice(0, 7); }
      selDay = date;
      showOk(`Added ${gbp(amt)} ${dir < 0 ? "spent on" : "to"} ${cat}`);
      load();
    } catch (e) { alert(e.message); }
  };
  d.showModal();
  d.querySelector("#a-amt").focus();
};

// ---------- Settings: accounts, Monzo, uploads ----------
function openSettings() {
  const d = $("dlg");
  const today = todayStr();
  d.innerHTML = `<h3>Accounts</h3><div class="muted small">Monzo updates by itself. For Nationwide and Amex, upload a CSV statement every week or so.</div>
    <div style="margin-top:8px">${data.accounts.map((a) => {
      let st = "";
      if (a.source === "monzo") st = data.monzo.waiting ? "approve in the Monzo app" : data.monzo.connected ? `live${data.monzo.last_sync ? ` · synced ${new Date(data.monzo.last_sync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}` : "disconnected";
      else if (a.latest) st = `up to ${fmtDay(a.latest, { day: "numeric", month: "short" })}${(Date.parse(today) - Date.parse(a.latest)) / 86400000 > 10 ? " — upload a new one" : ""}`;
      return `<div class="acct"><div class="nm"><b>${esc(a.bank)}</b> ${esc(a.name)}${a.mask ? ` ••${esc(a.mask)}` : ""}<small>${esc(st)}${a.balance ? ` · ${gbp(a.balance.amount)}` : ""}</small></div>
        ${a.source === "upload" ? `<button class="ghost" type="button" data-up="${esc(a.key)}" style="padding:6px 10px;font-size:13px">Upload</button>` : ""}
        <button class="link" type="button" data-rm="${esc(a.key)}" data-n="${esc(a.bank + " " + a.name)}" style="color:var(--muted)">Remove</button></div>`;
    }).join("") || `<div class="empty">No accounts yet.</div>`}</div>
    <div class="actions" style="flex-wrap:wrap;justify-content:stretch">
      <button type="button" id="s-monzo" style="flex:1">${data.monzo.connected ? "Reconnect Monzo" : "Connect Monzo"}</button>
      <button class="ghost" type="button" id="s-up" style="flex:1">Upload statement</button>
      ${data.monzo.connected ? `<button class="ghost" type="button" id="s-sync" style="flex:1">Sync Monzo now</button>` : ""}
    </div>
    <div class="actions"><button class="ghost" type="button" id="x">Done</button></div>`;
  d.querySelector("#x").onclick = () => d.close();
  d.querySelector("#s-monzo").onclick = async () => {
    try { const r = await api("/api/budget/monzo/connect", { method: "POST", body: {} }); location.href = r.url; } catch (e) { alert(e.message); }
  };
  d.querySelector("#s-up").onclick = () => upload();
  d.querySelector("#s-sync")?.addEventListener("click", () => { d.close(); sync(true); });
  d.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => upload(b.dataset.up)));
  d.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.n}? Its transactions already here stay.`)) return;
    try { await api(`/api/budget/account/${b.dataset.rm}`, { method: "DELETE" }); await load(); openSettings(); } catch (e) { alert(e.message); }
  }));
  if (!d.open) d.showModal();
}
$("settings").onclick = openSettings;

async function sync(force, quiet) {
  try {
    const r = await api("/api/budget/sync", { method: "POST", body: { force } });
    if (r.status === "approve") showOk("Open the Monzo app and approve access — this page will pick it up.", true);
    else if (r.status === "reconnect") showErr(r.message);
    else if (r.status === "ok" && !quiet && !r.skipped) showOk(`Monzo synced · ${r.added} new`);
    await load();
    return r.status;
  } catch (e) { showErr(e.message); }
}

async function waitForApproval() {
  showOk("Waiting for you to approve access in the Monzo app…", true);
  for (let i = 0; i < 60; i++) {
    const st = await sync(true, true);
    if (st === "ok") { showOk("Monzo connected — your history is in."); return; }
    if (st !== "approve") return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  showErr("Still waiting for the Monzo approval. Approve it in the app, then use Sync Monzo now.");
}

function upload(acctKey) {
  const d = $("dlg");
  const ups = data.accounts.filter((a) => a.source === "upload");
  d.innerHTML = `<h3>Upload a statement</h3>
    <div class="muted small">CSV file from your bank's website or app. It's read on this device first so you can check it.</div>
    <label class="fld"><span>Which account?</span><select id="u-acct">
      ${ups.map((a) => `<option value="${esc(a.key)}">${esc(a.bank)} ${esc(a.name)}${a.mask ? ` ••${esc(a.mask)}` : ""}</option>`).join("")}
      ${PRESETS.map((p) => `<option value="new:${p.id}">New: ${esc(p.bank)} ${esc(p.name)}</option>`).join("")}
    </select></label>
    <label class="fld" id="u-name-wrap" hidden><span>Name it (e.g. "Credit card", "Joint")</span><input type="text" id="u-name" maxlength="40"></label>
    <div class="drop" id="u-drop">Tap to choose a CSV file, or drop it here<input type="file" id="u-file" accept=".csv,text/csv" hidden></div>
    <div id="u-prev"></div>
    <div class="actions"><button class="ghost" type="button" id="x">Cancel</button><button type="button" id="u-go" disabled>Import</button></div>`;
  const sel = d.querySelector("#u-acct"), nameWrap = d.querySelector("#u-name-wrap"), nameIn = d.querySelector("#u-name");
  const fileIn = d.querySelector("#u-file"), drop = d.querySelector("#u-drop"), prev = d.querySelector("#u-prev"), go2 = d.querySelector("#u-go");
  let parsed = null, file = null, flip = false;
  const preset = () => {
    const v = sel.value;
    if (v.startsWith("new:")) return PRESETS.find((p) => p.id === v.slice(4));
    const a = ups.find((x) => x.key === v);
    if (a?.bank === "American Express") return PRESETS.find((p) => p.id === "amex");
    return PRESETS.find((p) => p.bank === a?.bank) || PRESETS.at(-1);
  };
  const syncName = () => { const isNew = sel.value.startsWith("new:"); nameWrap.hidden = !isNew; if (isNew) nameIn.value = preset().name; };
  sel.value = acctKey || ups[0]?.key || "new:nationwide";
  syncName();
  const fmt = (x) => fmtDay(x, { day: "numeric", month: "short", year: "numeric" });
  async function readIt() {
    if (!file) return;
    try {
      parsed = await readStatement(file, preset());
      if (flip) parsed.rows.forEach((r) => (r.amount = -r.amount));
      const ins = parsed.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
      const outs = -parsed.rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
      prev.innerHTML = `<div class="small" style="margin-top:12px">${parsed.rows.length} transactions, ${fmt(parsed.from)} – ${fmt(parsed.to)}<br>
        Money out <b>${gbp(outs)}</b> · money in <b class="up">${gbp(ins)}</b>${parsed.balance !== null ? ` · balance ${gbp(parsed.balance)}` : ""}</div>
        <div class="prev">${parsed.rows.slice(0, 6).map((r) => `<div class="tx"><div class="mid"><div class="d">${esc(r.desc)}</div><div class="m">${fmt(r.date)}</div></div>
          <div class="a ${r.amount > 0 ? "up" : ""}">${gbp(r.amount, true)}</div></div>`).join("")}</div>
        <label class="chk"><input type="checkbox" id="u-flip" ${flip ? "checked" : ""}> Spending shows as money in — flip it</label>`;
      d.querySelector("#u-flip").onchange = (e) => { flip = e.target.checked; readIt(); };
      go2.disabled = false;
    } catch (e) {
      parsed = null; go2.disabled = true;
      prev.innerHTML = `<p class="small" style="color:var(--danger);margin-top:10px">${esc(e.message)}</p>`;
    }
  }
  const take = (f) => { file = f; flip = false; drop.textContent = f.name; drop.append(fileIn); readIt(); };
  sel.onchange = () => { syncName(); readIt(); };
  drop.onclick = () => fileIn.click();
  fileIn.onchange = () => fileIn.files[0] && take(fileIn.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("on"); };
  drop.ondragleave = () => drop.classList.remove("on");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("on"); e.dataTransfer.files[0] && take(e.dataTransfer.files[0]); };
  d.querySelector("#x").onclick = () => d.close();
  go2.onclick = async () => {
    if (!parsed) return;
    go2.disabled = true; go2.textContent = "Importing…";
    const v = sel.value;
    const account = v.startsWith("new:") ? { bank: preset().bank, name: nameIn.value.trim() || preset().name } : { key: v };
    try {
      const r = await api("/api/budget/import", { method: "POST", body: { account, rows: parsed.rows, balance: parsed.balance } });
      d.close();
      showOk(`Imported ${r.added} new transaction${r.added === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} already here)` : ""}.`);
      month = parsed.to.slice(0, 7);
      history.replaceState(null, "", month === thisMonth() ? location.pathname : `?month=${month}`);
      load();
    } catch (e) { go2.disabled = false; go2.textContent = "Import"; prev.insertAdjacentHTML("beforeend", `<p class="small" style="color:var(--danger)">${esc(e.message)}</p>`); }
  };
  if (!d.open) d.showModal();
}

// Close a sheet by tapping outside it
$("dlg").addEventListener("click", (e) => { if (e.target === $("dlg")) $("dlg").close(); });

// ---------- Start ----------
(async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get("monzo")) {
    history.replaceState(null, "", location.pathname);
    await load();
    waitForApproval();
  } else {
    await load();
    if (data?.monzo.connected) sync(false, true);   // quiet top-up (at most every 15 minutes)
  }
})();

// Holiday budgets: make a holiday, then log what you spend — in the local currency or pounds.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gbp = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gbp0 = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(Math.round(n)).toLocaleString("en-GB");
const money = (n, cur) => {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n); }
  catch { return `${cur} ${n.toFixed(2)}`; }
};
const todayStr = () => new Date().toLocaleDateString("en-CA");
const fmtDay = (d, opts = { weekday: "short", day: "numeric", month: "short" }) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", opts);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

const ICON = { Package: "🧳", Flights: "✈️", Hotel: "🏨", "Food & drink": "🍽️", Transport: "🚕", Activities: "🎟️", Shopping: "🛍️", Other: "•" };
const COLOR = { Package: "#4f6bed", Flights: "#1f9fd1", Hotel: "#7c5cc4", "Food & drink": "#e8833a", Transport: "#3b82c4", Activities: "#2fa3a3", Shopping: "#d9a21b", Other: "#9aa0a6" };
const EMOJIS = ["🌴", "🏖️", "🏝️", "🏔️", "⛷️", "🏙️", "🗽", "🕌", "🐪", "🗼", "🎡", "🚢", "✈️", "🧳"];
const CURRENCIES = ["GBP", "AED", "EUR", "USD", "THB", "INR", "JPY", "TRY", "CHF", "AUD", "CAD", "SGD", "MXN", "ZAR", "EGP", "MAD"];

let hols = [], hol = null, cats = Object.keys(ICON);

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
let msgT;
function showOk(m) { $("okmsg").textContent = m; $("okmsg").hidden = false; $("err").hidden = true; clearTimeout(msgT); msgT = setTimeout(() => ($("okmsg").hidden = true), 3500); }
function showErr(m) { $("err").textContent = m; $("err").hidden = false; }

function status(h) {
  const t = todayStr();
  if (h.start && t < h.start) { const n = days(t, h.start); return ["soon", n === 1 ? "Tomorrow" : `In ${n} days`]; }
  if (h.end && t > h.end) return ["done", "Been"];
  if (h.start) return ["now", "Away now"];
  return ["", ""];
}
const dateRange = (h) => h.start ? `${fmtDay(h.start, { day: "numeric", month: "short" })}${h.end ? ` – ${fmtDay(h.end, { day: "numeric", month: "short", year: "numeric" })}` : ""}` : "No dates yet";
const meterClass = (pct) => (pct > 100 ? "over" : pct > 85 ? "warn" : "");

// ---------- all holidays ----------
async function showList() {
  hol = null;
  history.replaceState(null, "", location.pathname);
  $("hol-view").hidden = true; $("list-view").hidden = false; $("add").hidden = true; $("edit-hol").hidden = true;
  $("title").textContent = "Holidays"; $("back").href = "/dashboard/";
  try { hols = (await api("/api/holidays")).holidays; } catch (e) { return showErr(e.message); }
  $("hols").innerHTML = hols.length ? hols.map((h) => {
    const [cls, word] = status(h);
    const pct = h.budget ? Math.min(140, (h.spent / h.budget) * 100) : 0;
    return `<div class="card hol-card" data-id="${esc(h.id)}"><div class="row"><div class="em">${esc(h.emoji || "🌴")}</div>
      <div class="nm"><b>${esc(h.name)}${word ? `<span class="badge ${cls}">${word}</span>` : ""}</b><small>${esc(h.place ? h.place + " · " : "")}${dateRange(h)}</small></div>
      <div class="amt">${gbp0(h.spent)}<small>${h.budget ? `of ${gbp0(h.budget)}` : `${h.count} expense${h.count === 1 ? "" : "s"}`}</small></div></div>
      ${h.budget ? `<div class="meter"><i class="${meterClass(pct)}" style="width:${Math.min(100, pct)}%"></i></div>` : ""}</div>`;
  }).join("") : `<div class="card"><div class="empty">No holidays yet. Make one, then add what you spend as you go.</div></div>`;
  $("hols").querySelectorAll("[data-id]").forEach((c) => (c.onclick = () => open(c.dataset.id)));
}

// ---------- one holiday ----------
async function open(id) {
  try { const d = await api(`/api/holidays/${id}`); hol = d.holiday; cats = d.categories; } catch (e) { return showErr(e.message); }
  history.replaceState(null, "", `?h=${id}`);
  drawHoliday();
}

function drawHoliday() {
  const h = hol;
  $("list-view").hidden = true; $("hol-view").hidden = false; $("add").hidden = false; $("edit-hol").hidden = false;
  $("title").textContent = h.name; $("back").href = "#";
  $("h-emoji").textContent = h.emoji || "🌴";
  $("h-name").textContent = h.name;
  $("h-sub").textContent = [h.place, dateRange(h), h.currency !== "GBP" && h.rate ? `1 ${h.currency} = £${h.rate}` : ""].filter(Boolean).join(" · ");
  $("h-spent").textContent = gbp(h.spent);
  $("h-budget").textContent = h.budget ? gbp0(h.budget) : "Not set";
  $("h-left").textContent = h.budget ? gbp(h.left) : "–";
  $("h-left").className = `v ${h.left < 0 ? "down" : ""}`;
  const pct = h.budget ? (h.spent / h.budget) * 100 : 0;
  $("h-bar").style.width = `${Math.min(100, pct)}%`; $("h-bar").className = meterClass(pct);

  // daily pace: what you're spending a day on the trip (not counting flights/hotel booked ahead) vs what's left per day
  const t = todayStr();
  const tripDays = h.start && h.end ? days(h.start, h.end) + 1 : 0;
  if (tripDays) {
    const elapsed = t < h.start ? 0 : t > h.end ? tripDays : days(h.start, t) + 1;
    const remaining = t < h.start ? tripDays : t > h.end ? 0 : tripDays - elapsed + 1;   // including today
    const onTrip = h.expenses.filter((e) => e.date >= h.start && e.date <= h.end && !["Package", "Flights", "Hotel"].includes(e.cat)).reduce((s, e) => s + e.home, 0);
    $("pace-card").hidden = false;
    $("pace-days").textContent = t < h.start ? `${tripDays} days` : t > h.end ? `${tripDays} days, all done` : `day ${elapsed} of ${tripDays}`;
    $("pace-avg").textContent = elapsed ? gbp(onTrip / elapsed) : "–";
    $("pace-allow").textContent = h.budget && remaining ? gbp(Math.max(0, h.left) / remaining) : "–";
  } else $("pace-card").hidden = true;

  const catRows = Object.entries(h.byCat).sort((a, b) => b[1] - a[1]);
  const top = catRows[0]?.[1] || 1;
  $("h-cats").innerHTML = catRows.length ? catRows.map(([c, v]) => `<div class="bud"><div class="row"><div class="ico">${ICON[c] || "•"}</div><div class="nm">${esc(c)}</div>
      <div class="amt">${gbp(v)}<small>${h.spent ? Math.round((v / h.spent) * 100) : 0}%</small></div></div>
      <div class="meter"><i style="width:${(v / top) * 100}%;background:${COLOR[c] || "#9aa0a6"}"></i></div></div>`).join("")
    : `<div class="empty">Nothing spent yet. Tap ＋ to add something.</div>`;

  $("h-count").textContent = h.expenses.length ? `${h.expenses.length}` : "";
  let html = "", day = "";
  for (const e of h.expenses) {
    if (e.date !== day) { day = e.date; html += `<div class="day">${fmtDay(day)}</div>`; }
    const local = e.cur === "local" && h.currency !== "GBP";
    html += `<div class="tx" data-e="${esc(e.id)}"><div class="ico">${ICON[e.cat] || "•"}</div>
      <div class="mid"><div class="d">${esc(e.note || e.cat)}</div><div class="m">${esc(e.cat)}${local ? ` · ${money(e.amount, h.currency)}` : ""}</div></div>
      <div class="a">${gbp(e.home)}</div></div>`;
  }
  $("h-exp").innerHTML = html || `<div class="empty">No expenses yet.</div>`;
  $("h-exp").querySelectorAll("[data-e]").forEach((r) => (r.onclick = () => expenseSheet(h.expenses.find((x) => x.id === r.dataset.e))));
}

// ---------- add / edit an expense ----------
function expenseSheet(existing) {
  const h = hol, d = $("dlg");
  const foreign = h.currency !== "GBP" && h.rate;
  let cur = existing ? existing.cur : foreign ? "local" : "home";
  let cat = existing?.cat || "Food & drink";
  d.innerHTML = `<h3>${existing ? "Edit expense" : "Add expense"}</h3>
    ${foreign ? `<div class="cur-toggle"><button type="button" data-c="local">${esc(h.currency)}</button><button type="button" data-c="home">GBP £</button></div>` : ""}
    <label class="fld"><input type="text" inputmode="decimal" id="x-amt" class="amount-in" placeholder="0.00" value="${existing ? existing.amount : ""}" autocomplete="off"></label>
    <div class="conv" id="x-conv"></div>
    <div class="fld"><span>Category</span><div class="chips">${cats.map((c) => `<button type="button" data-cat="${esc(c)}"><span>${ICON[c] || "•"}</span>${esc(c)}</button>`).join("")}</div></div>
    <div class="two-col">
      <label class="fld"><span>What for</span><input type="text" id="x-note" maxlength="80" placeholder="e.g. Dinner at the marina" value="${esc(existing?.note || "")}"></label>
      <label class="fld"><span>Date</span><input type="date" id="x-date" value="${existing?.date || (h.start && todayStr() < h.start ? todayStr() : h.end && todayStr() > h.end ? h.end : todayStr())}"></label>
    </div>
    <div class="actions">${existing ? `<button class="ghost grow" type="button" id="x-del" style="color:var(--danger)">Delete</button>` : ""}
      <button class="ghost" type="button" id="x-cancel">Cancel</button><button type="button" id="x-save">${existing ? "Save" : "Add"}</button></div>`;
  const amt = d.querySelector("#x-amt");
  const conv = () => {
    const v = parseFloat(amt.value.replace(/,/g, ""));
    d.querySelector("#x-conv").textContent = foreign && v > 0 ? (cur === "local" ? `≈ ${gbp(v * h.rate)}` : `≈ ${money(v / h.rate, h.currency)}`) : "";
  };
  const drawCur = () => d.querySelectorAll("[data-c]").forEach((b) => b.classList.toggle("on", b.dataset.c === cur));
  const drawCat = () => d.querySelectorAll("[data-cat]").forEach((b) => b.classList.toggle("on", b.dataset.cat === cat));
  d.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { cur = b.dataset.c; drawCur(); conv(); }));
  d.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { cat = b.dataset.cat; drawCat(); }));
  amt.oninput = conv;
  drawCur(); drawCat(); conv();
  d.querySelector("#x-cancel").onclick = () => d.close();
  if (existing) d.querySelector("#x-del").onclick = async () => {
    if (!confirm("Delete this expense?")) return;
    try { hol = (await api(`/api/holidays/${h.id}/expenses/${existing.id}`, { method: "DELETE" })).holiday; d.close(); drawHoliday(); } catch (e) { alert(e.message); }
  };
  d.querySelector("#x-save").onclick = async () => {
    const body = { amount: parseFloat(amt.value.replace(/,/g, "")), cur, cat, note: d.querySelector("#x-note").value, date: d.querySelector("#x-date").value };
    try {
      hol = (await api(`/api/holidays/${h.id}/expenses${existing ? `/${existing.id}` : ""}`, { method: existing ? "PUT" : "POST", body })).holiday;
      d.close(); drawHoliday(); showOk(existing ? "Saved." : `Added ${gbp(body.cur === "local" && foreign ? body.amount * h.rate : body.amount)}.`);
    } catch (e) { alert(e.message); }
  };
  d.showModal();
  setTimeout(() => amt.focus(), 50);
}

// ---------- make / edit a holiday ----------
function holidaySheet(existing) {
  const d = $("dlg");
  const h = existing || { emoji: "🌴", currency: "GBP" };
  let emoji = h.emoji || "🌴";
  d.innerHTML = `<h3>${existing ? "Holiday details" : "New holiday"}</h3>
    <div class="fld"><div class="emoji-row">${EMOJIS.map((e) => `<button type="button" data-em="${e}">${e}</button>`).join("")}</div></div>
    <label class="fld"><span>Name</span><input type="text" id="f-name" maxlength="50" placeholder="e.g. Dubai November" value="${esc(h.name || "")}"></label>
    <label class="fld"><span>Where</span><input type="text" id="f-place" maxlength="60" placeholder="e.g. Dubai, UAE" value="${esc(h.place || "")}"></label>
    <div class="two-col">
      <label class="fld"><span>From</span><input type="date" id="f-start" value="${h.start || ""}"></label>
      <label class="fld"><span>To</span><input type="date" id="f-end" value="${h.end || ""}"></label>
    </div>
    <label class="fld"><span>Budget for the whole holiday (£)</span><input type="text" inputmode="decimal" id="f-budget" placeholder="e.g. 2500" value="${h.budget || ""}"></label>
    ${existing ? "" : `<label class="fld"><span>Package price — flights + hotel (£, optional)</span><input type="text" inputmode="decimal" id="f-pkg" placeholder="e.g. 1820"></label>`}
    <div class="two-col">
      <label class="fld"><span>Local currency</span><select id="f-cur">${[...new Set([h.currency, ...CURRENCIES])].map((c) => `<option ${c === h.currency ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label class="fld" id="f-rate-wrap"><span>£ per 1 <b id="f-rate-cur">${esc(h.currency)}</b></span>
        <div class="rate-row"><input type="text" inputmode="decimal" id="f-rate" value="${h.rate && h.currency !== "GBP" ? h.rate : ""}"><button type="button" class="ghost" id="f-getrate">Today's</button></div></label>
    </div>
    <div class="actions">${existing ? `<button class="ghost grow" type="button" id="f-del" style="color:var(--danger)">Delete</button>` : ""}
      <button class="ghost" type="button" id="f-cancel">Cancel</button><button type="button" id="f-save">${existing ? "Save" : "Create"}</button></div>`;
  const drawEm = () => d.querySelectorAll("[data-em]").forEach((b) => b.classList.toggle("on", b.dataset.em === emoji));
  d.querySelectorAll("[data-em]").forEach((b) => (b.onclick = () => { emoji = b.dataset.em; drawEm(); }));
  drawEm();
  const curSel = d.querySelector("#f-cur"), rateIn = d.querySelector("#f-rate");
  const getRate = async () => {
    if (curSel.value === "GBP") return;
    const btn = d.querySelector("#f-getrate"); btn.disabled = true; btn.textContent = "…";
    try { rateIn.value = Number((await api(`/api/holidays/rate?from=${curSel.value}&to=GBP`)).rate.toPrecision(4)); } catch (e) { alert(e.message); }
    btn.disabled = false; btn.textContent = "Today's";
  };
  const syncCur = (fetchRate) => {
    d.querySelector("#f-rate-wrap").hidden = curSel.value === "GBP";
    d.querySelector("#f-rate-cur").textContent = curSel.value;
    if (fetchRate) { rateIn.value = ""; getRate(); }
  };
  curSel.onchange = () => syncCur(true);
  d.querySelector("#f-getrate").onclick = getRate;
  syncCur(false);
  d.querySelector("#f-cancel").onclick = () => d.close();
  if (existing) d.querySelector("#f-del").onclick = async () => {
    if (!confirm(`Delete ${existing.name} and all its expenses?`)) return;
    try { await api(`/api/holidays/${existing.id}`, { method: "DELETE" }); d.close(); showList(); } catch (e) { alert(e.message); }
  };
  d.querySelector("#f-save").onclick = async () => {
    const body = {
      name: d.querySelector("#f-name").value, place: d.querySelector("#f-place").value, emoji,
      start: d.querySelector("#f-start").value, end: d.querySelector("#f-end").value,
      budget: parseFloat(d.querySelector("#f-budget").value.replace(/[£,]/g, "")) || 0,
      currency: curSel.value, rate: parseFloat(rateIn.value) || null,
      packagePrice: existing ? undefined : parseFloat((d.querySelector("#f-pkg")?.value || "").replace(/[£,]/g, "")) || 0,
    };
    if (body.currency !== "GBP" && !body.rate) return alert(`Add the exchange rate (£ per 1 ${body.currency}) — tap "Today's" to fetch it.`);
    try {
      const r = await api(`/api/holidays${existing ? `/${existing.id}` : ""}`, { method: existing ? "PUT" : "POST", body });
      hol = r.holiday; d.close(); drawHoliday(); history.replaceState(null, "", `?h=${hol.id}`);
      showOk(existing ? "Saved." : "Holiday created — tap ＋ to add what you spend.");
    } catch (e) { alert(e.message); }
  };
  d.showModal();
  if (!existing) setTimeout(() => d.querySelector("#f-name").focus(), 50);
}

$("new-hol").onclick = () => holidaySheet(null);
$("add").onclick = () => hol && expenseSheet(null);
$("edit-hol").onclick = () => hol && holidaySheet(hol);
$("back").onclick = (e) => { if (hol) { e.preventDefault(); showList(); } };
$("dlg").addEventListener("click", (e) => { if (e.target === $("dlg")) $("dlg").close(); });

const start = new URLSearchParams(location.search).get("h");
if (start) open(start).catch(() => showList()); else showList();

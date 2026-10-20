// Budget page: month totals, spending by category against budgets, transactions, connected banks.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gbp = (n, sign = false) => (sign && n > 0 ? "+" : n < 0 ? "−" : "") + "£" + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thisMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);

let month = new URLSearchParams(location.search).get("month") || thisMonth();
let data = null;
let catFilter = "";

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

function showErr(msg) { $("err").textContent = msg || ""; $("err").hidden = !msg; }
function showOk(msg) { $("okmsg").textContent = msg || ""; $("okmsg").hidden = !msg; }

function shiftMonth(delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  month = d.toLocaleDateString("en-CA").slice(0, 7);
  history.replaceState(null, "", month === thisMonth() ? location.pathname : `?month=${month}`);
  load();
}

async function load() {
  const [y, m] = month.split("-").map(Number);
  $("month").textContent = new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  $("next").disabled = month >= thisMonth();
  try {
    data = await api(`/api/budget/summary?month=${month}`);
    draw();
  } catch (e) { showErr(e.message); }
}

function draw() {
  const t = data.totals;
  $("t-in").textContent = gbp(t.income);
  $("t-out").textContent = gbp(t.spent);
  $("t-left").textContent = gbp(t.left);
  $("t-left").className = "v " + (t.left >= 0 ? "up" : "down");
  if (t.budget) {
    const pct = Math.round((t.budgetSpent / t.budget) * 100);
    $("t-bud").textContent = `${pct}%`;
    $("t-bud").className = "v " + (pct > 100 ? "down" : pct > 85 ? "" : "up");
    $("t-bud-s").textContent = `${gbp(t.budgetSpent)} of ${gbp(t.budget)}`;
  } else { $("t-bud").textContent = "–"; $("t-bud-s").textContent = "set limits below"; }
  $("synced").textContent = data.lastSync ? `Synced ${new Date(data.lastSync).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";
  $("sync").hidden = !data.connections.length;

  // Categories
  $("cats").innerHTML = data.categories.length ? data.categories.map((c) => {
    const pct = c.budget ? Math.min(100, (c.spent / c.budget) * 100) : null;
    const cls = c.budget ? (c.spent > c.budget ? "over" : c.spent > c.budget * 0.85 ? "warn" : "") : "";
    const width = pct ?? Math.min(100, (c.spent / Math.max(...data.categories.map((x) => x.spent), 1)) * 100);
    return `<div class="cat${catFilter === c.name ? " on" : ""}" data-cat="${esc(c.name)}">
      <div class="row"><span class="nm">${esc(c.name)}</span><span class="amt">${gbp(c.spent)}</span>
      ${c.budget ? `<span class="of">/ ${gbp(c.budget)}</span>` : ""}</div>
      <div class="meter"><i class="${cls}" style="width:${width}%;${c.budget ? "" : "opacity:.45"}"></i></div></div>`;
  }).join("") : `<p class="muted small">${data.connections.length ? "No spending this month yet." : "Connect a bank to see where your money goes."}</p>`;
  $("cats").querySelectorAll(".cat").forEach((el) => el.onclick = () => {
    catFilter = catFilter === el.dataset.cat ? "" : el.dataset.cat;
    $("f-cat").value = catFilter;
    draw();
  });

  // Banks
  $("banks").innerHTML = data.connections.map((c) => `
    <div class="bank"><div class="hd"><b>${esc(c.bank)}</b>
      <span class="exp ${c.days_left < 7 ? "down" : "muted"}">${c.days_left < 0 ? "Expired — reconnect" : `renew in ${c.days_left} days`}</span>
      <button class="link small" data-remove="${esc(c.id)}" style="color:var(--muted)">Remove</button></div>
      ${c.accounts.map((a) => `<div class="acc"><span>${esc(a.name)}${a.mask ? ` ••${esc(a.mask)}` : ""}</span>
        <span>${a.balance ? gbp(a.balance.amount) : ""}</span></div>`).join("")}
    </div>`).join("") || `<p class="muted small" style="margin:0">No banks connected yet. Add Nationwide, Monzo and American Express below.</p>`;
  $("banks").querySelectorAll("[data-remove]").forEach((b) => b.onclick = async () => {
    if (!confirm("Remove this bank? Transactions already pulled in stay.")) return;
    try { await api(`/api/budget/connection/${b.dataset.remove}`, { method: "DELETE" }); load(); } catch (e) { showErr(e.message); }
  });
  $("connect").hidden = !data.configured;
  if (!data.configured) $("banks").insertAdjacentHTML("beforeend", `<p class="small" style="color:var(--danger)">Bank linking isn't set up yet — see the steps Claude gave you (Enable Banking app ID and key in Cloudflare).</p>`);

  // Category filter options
  const sel = $("f-cat");
  if (sel.options.length <= 1) sel.insertAdjacentHTML("beforeend", data.allCategories.map((c) => `<option>${esc(c)}</option>`).join(""));
  sel.value = catFilter;
  drawTx();
}

function drawTx() {
  const q = $("q").value.trim().toLowerCase();
  const list = data.transactions.filter((t) =>
    (!catFilter || t.cat === catFilter) && (!q || `${t.desc} ${t.note || ""} ${t.account}`.toLowerCase().includes(q)));
  let html = "", day = "";
  for (const t of list) {
    if (t.date !== day) {
      day = t.date;
      html += `<div class="day">${new Date(day + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>`;
    }
    html += `<div class="tx${t.cat === "Transfers" ? " transfer" : ""}">
      <div class="d">${esc(t.desc)}</div><div class="a ${t.amount > 0 ? "up" : ""}">${gbp(t.amount, true)}</div>
      <div class="m"><button class="catbtn" data-id="${esc(t.id)}">${esc(t.cat)} ▾</button><span>${esc(t.account)}</span></div><div></div></div>`;
  }
  $("txs").innerHTML = html || `<p class="muted small">${data.transactions.length ? "Nothing matches." : "No transactions this month."}</p>`;
  $("txs").querySelectorAll(".catbtn").forEach((b) => b.onclick = () => pickCategory(data.transactions.find((t) => t.id === b.dataset.id)));
}

// ---------- Dialogs ----------
function pickCategory(tx) {
  const d = $("dlg");
  d.innerHTML = `<h3>${esc(tx.desc)}</h3><div class="muted small">${gbp(tx.amount, true)} · ${esc(tx.account)}</div>
    <div class="grid2">${data.allCategories.map((c) => `<button type="button" class="${c === tx.cat ? "on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <label class="chk"><input type="checkbox" id="always" checked> Always use this for “${esc(tx.desc.slice(0, 30))}”</label>
    <div class="actions"><button class="ghost" type="button" id="dlg-x">Cancel</button></div>`;
  d.querySelector("#dlg-x").onclick = () => d.close();
  d.querySelectorAll("[data-c]").forEach((b) => b.onclick = async () => {
    try {
      await api("/api/budget/category", { method: "PUT", body: { id: tx.id, month, cat: b.dataset.c, always: d.querySelector("#always").checked } });
      d.close(); load();
    } catch (e) { d.close(); showErr(e.message); }
  });
  d.showModal();
}

function editBudgets() {
  const d = $("dlg");
  const current = Object.fromEntries(data.categories.filter((c) => c.budget).map((c) => [c.name, c.budget]));
  const cats = data.allCategories.filter((c) => !["Income", "Transfers"].includes(c));
  d.innerHTML = `<h3>Monthly budgets</h3><div class="muted small">Leave blank for no limit.</div>
    <form id="bf" style="margin-top:10px">${cats.map((c) => `<div class="brow"><span>${esc(c)}</span>
      <input inputmode="decimal" name="${esc(c)}" value="${current[c] ?? ""}" placeholder="£"></div>`).join("")}
    <div class="actions"><button class="ghost" type="button" id="dlg-x">Cancel</button><button type="submit">Save</button></div></form>`;
  d.querySelector("#dlg-x").onclick = () => d.close();
  d.querySelector("#bf").onsubmit = async (e) => {
    e.preventDefault();
    const budgets = {};
    for (const c of cats) { const v = e.target.elements[c].value.replace(/[£,\s]/g, ""); if (v) budgets[c] = v; }
    try { await api("/api/budget/budgets", { method: "PUT", body: { budgets } }); d.close(); load(); } catch (err) { showErr(err.message); }
  };
  d.showModal();
}

// ---------- Sync & connect ----------
async function sync(force) {
  $("sync").disabled = true; $("sync").textContent = "Syncing…";
  try {
    const r = await api("/api/budget/sync", { method: "POST", body: { force } });
    if (r.errors?.length) showErr(r.errors.join(" · ")); else showErr("");
    if (force && !r.skipped) showOk(`Synced ${r.accounts} account${r.accounts === 1 ? "" : "s"} · ${r.added} new transaction${r.added === 1 ? "" : "s"}`);
    await load();
  } catch (e) { showErr(e.message); }
  $("sync").disabled = false; $("sync").textContent = "Sync now";
}

async function loadBanks() {
  try {
    const r = await api("/api/budget/banks");
    $("bank-list").innerHTML = r.banks.map((b) => `<option value="${esc(b)}">`).join("");
  } catch { /* shown via the summary if not set up */ }
}

$("connect").onsubmit = async (e) => {
  e.preventDefault();
  const bank = $("bank-search").value.trim();
  if (!bank) return;
  try {
    const r = await api("/api/budget/connect", { method: "POST", body: { bank } });
    location.href = r.url;
  } catch (err) { showErr(err.message); }
};

$("prev").onclick = () => shiftMonth(-1);
$("next").onclick = () => shiftMonth(1);
$("sync").onclick = () => sync(true);
$("edit-budgets").onclick = editBudgets;
$("q").oninput = drawTx;
$("f-cat").onchange = () => { catFilter = $("f-cat").value; draw(); };

(async function boot() {
  if (new URLSearchParams(location.search).get("connected")) {
    showOk("Bank connected. The last 90 days are being pulled in — this can take a minute.");
    history.replaceState(null, "", location.pathname);
    await load();
    setTimeout(load, 8000);
  } else {
    await load();
    if (data?.connections.length) sync(false);     // background top-up (at most every 6 hours)
  }
  if (data?.configured) loadBanks();
})();

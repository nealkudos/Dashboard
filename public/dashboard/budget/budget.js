// Budget page: month totals, spending by category against budgets, transactions, accounts (Monzo live + uploads).
import { PRESETS, readStatement } from "./statements.js";
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

  // Categories
  $("cats").innerHTML = data.categories.length ? data.categories.map((c) => {
    const pct = c.budget ? Math.min(100, (c.spent / c.budget) * 100) : null;
    const cls = c.budget ? (c.spent > c.budget ? "over" : c.spent > c.budget * 0.85 ? "warn" : "") : "";
    const width = pct ?? Math.min(100, (c.spent / Math.max(...data.categories.map((x) => x.spent), 1)) * 100);
    return `<div class="cat${catFilter === c.name ? " on" : ""}" data-cat="${esc(c.name)}">
      <div class="row"><span class="nm">${esc(c.name)}</span><span class="amt">${gbp(c.spent)}</span>
      ${c.budget ? `<span class="of">/ ${gbp(c.budget)}</span>` : ""}</div>
      <div class="meter"><i class="${cls}" style="width:${width}%;${c.budget ? "" : "opacity:.45"}"></i></div></div>`;
  }).join("") : `<p class="muted small">${data.accounts.length ? "No spending this month yet." : "Connect Monzo or upload a statement to see where your money goes."}</p>`;
  $("cats").querySelectorAll(".cat").forEach((el) => el.onclick = () => {
    catFilter = catFilter === el.dataset.cat ? "" : el.dataset.cat;
    $("f-cat").value = catFilter;
    draw();
  });

  // Accounts
  const fmtDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const today = new Date().toLocaleDateString("en-CA");
  $("banks").innerHTML = data.accounts.map((a) => {
    let status = "";
    if (a.source === "monzo") {
      status = data.monzo.waiting ? `<span class="stale">approve in the Monzo app</span>` :
        data.monzo.connected ? `<span class="muted">live</span>` : `<span class="down">disconnected</span>`;
    } else if (a.latest) {
      const age = Math.round((Date.parse(today) - Date.parse(a.latest)) / 86400000);
      status = `<span class="${age > 10 ? "stale" : "muted"}">up to ${fmtDay(a.latest)}</span>`;
    }
    return `<div class="bank"><div class="hd"><b>${esc(a.bank)} <span class="muted" style="font-weight:400">${esc(a.name)}${a.mask ? ` ••${esc(a.mask)}` : ""}</span></b>
      <span class="exp">${status}</span>
      <button class="link small" data-remove="${esc(a.key)}" data-name="${esc(a.bank + " " + a.name)}" style="color:var(--muted)">Remove</button></div>
      ${a.balance ? `<div class="acc"><span>Balance${a.balance.asOf ? ` on ${fmtDay(a.balance.asOf)}` : ""}</span><span>${gbp(a.balance.amount)}</span></div>` : ""}
    </div>`;
  }).join("") || `<p class="muted small" style="margin:0">No accounts yet. Connect Monzo, then upload your Nationwide and Amex statements.</p>`;
  $("banks").querySelectorAll("[data-remove]").forEach((b) => b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.name}? Its transactions already here stay.`)) return;
    try { await api(`/api/budget/account/${b.dataset.remove}`, { method: "DELETE" }); load(); } catch (e) { showErr(e.message); }
  });
  $("connect-monzo").hidden = data.monzo.connected && !data.monzo.waiting;
  $("connect-monzo").textContent = data.monzo.connected ? "Reconnect Monzo" : "Connect Monzo";
  $("sync").hidden = !data.monzo.connected;

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

// ---------- Monzo ----------
async function sync(force, quiet) {
  $("sync").disabled = true; $("sync").textContent = "Syncing…";
  try {
    const r = await api("/api/budget/sync", { method: "POST", body: { force } });
    if (r.status === "approve") showOk("Open the Monzo app and approve access — this page will pick it up.");
    else if (r.status === "reconnect") showErr(r.message);
    else if (r.status === "ok" && !quiet && !r.skipped) showOk(`Monzo synced · ${r.added} new transaction${r.added === 1 ? "" : "s"}`);
    await load();
    return r.status;
  } catch (e) { showErr(e.message); }
  finally { $("sync").disabled = false; $("sync").textContent = "Sync now"; }
}

$("connect-monzo").onclick = async () => {
  try {
    const r = await api("/api/budget/monzo/connect", { method: "POST", body: {} });
    location.href = r.url;
  } catch (e) { showErr(e.message); }
};

// After signing in, keep checking until you've approved in the Monzo app (then pull the full history)
async function waitForApproval() {
  showOk("Waiting for you to approve access in the Monzo app…");
  for (let i = 0; i < 60; i++) {
    const st = await sync(true, true);
    if (st === "ok") { showOk("Monzo connected — your history is in."); return; }
    if (st !== "approve") return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  showErr("Still waiting for the Monzo approval. Approve it in the app, then press Sync now.");
}

// ---------- Statement upload ----------
function upload() {
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
    <div class="actions"><button class="ghost" type="button" id="dlg-x">Cancel</button><button type="button" id="u-go" disabled>Import</button></div>`;
  const sel = d.querySelector("#u-acct"), nameWrap = d.querySelector("#u-name-wrap"), nameIn = d.querySelector("#u-name");
  const fileIn = d.querySelector("#u-file"), drop = d.querySelector("#u-drop"), prev = d.querySelector("#u-prev"), go = d.querySelector("#u-go");
  let parsed = null, file = null, flip = false;

  const preset = () => {
    const v = sel.value;
    if (v.startsWith("new:")) return PRESETS.find((p) => p.id === v.slice(4));
    const a = ups.find((x) => x.key === v);
    return PRESETS.find((p) => p.bank === a?.bank && (p.name === a?.name || p.id !== "nationwide-cc")) || PRESETS.at(-1);
  };
  const syncName = () => {
    const isNew = sel.value.startsWith("new:");
    nameWrap.hidden = !isNew;
    if (isNew) nameIn.value = preset().name;
  };
  sel.value = ups[0]?.key || "new:nationwide";
  syncName();

  async function readIt() {
    if (!file) return;
    try {
      parsed = await readStatement(file, preset());
      if (flip) parsed.rows.forEach((r) => (r.amount = -r.amount));
      const ins = parsed.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
      const outs = -parsed.rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
      prev.innerHTML = `<div class="small" style="margin-top:12px">${parsed.rows.length} transactions, ${fmt(parsed.from)} – ${fmt(parsed.to)}<br>
        Money out <b>${gbp(outs)}</b> · money in <b class="up">${gbp(ins)}</b>${parsed.balance !== null ? ` · balance ${gbp(parsed.balance)}` : ""}</div>
        <div class="prev">${parsed.rows.slice(0, 6).map((r) => `<div class="tx"><div class="d">${esc(r.desc)}<div class="m">${fmt(r.date)}</div></div>
          <div class="a ${r.amount > 0 ? "up" : ""}">${gbp(r.amount, true)}</div></div>`).join("")}</div>
        <label class="chk"><input type="checkbox" id="u-flip" ${flip ? "checked" : ""}> Spending shows as money in — flip it</label>`;
      d.querySelector("#u-flip").onchange = (e) => { flip = e.target.checked; readIt(); };
      go.disabled = false;
    } catch (e) {
      parsed = null; go.disabled = true;
      prev.innerHTML = `<p class="small" style="color:var(--danger);margin-top:10px">${esc(e.message)}</p>`;
    }
  }
  const fmt = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const take = (f) => { file = f; flip = false; drop.textContent = f.name; drop.append(fileIn); readIt(); };

  sel.onchange = () => { syncName(); readIt(); };
  drop.onclick = () => fileIn.click();
  fileIn.onchange = () => fileIn.files[0] && take(fileIn.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("on"); };
  drop.ondragleave = () => drop.classList.remove("on");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("on"); e.dataTransfer.files[0] && take(e.dataTransfer.files[0]); };
  d.querySelector("#dlg-x").onclick = () => d.close();
  go.onclick = async () => {
    if (!parsed) return;
    go.disabled = true; go.textContent = "Importing…";
    const v = sel.value;
    const account = v.startsWith("new:") ? { bank: preset().bank, name: nameIn.value.trim() || preset().name } : { key: v };
    try {
      const r = await api("/api/budget/import", { method: "POST", body: { account, rows: parsed.rows, balance: parsed.balance } });
      d.close();
      showOk(`Imported ${r.added} new transaction${r.added === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} already here)` : ""}.`);
      month = parsed.to.slice(0, 7);
      history.replaceState(null, "", month === thisMonth() ? location.pathname : `?month=${month}`);
      load();
    } catch (e) { go.disabled = false; go.textContent = "Import"; prev.insertAdjacentHTML("beforeend", `<p class="small" style="color:var(--danger)">${esc(e.message)}</p>`); }
  };
  d.showModal();
}

$("prev").onclick = () => shiftMonth(-1);
$("next").onclick = () => shiftMonth(1);
$("sync").onclick = () => sync(true);
$("upload").onclick = upload;
$("edit-budgets").onclick = editBudgets;
$("q").oninput = drawTx;
$("f-cat").onchange = () => { catFilter = $("f-cat").value; draw(); };

(async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get("monzo")) {
    history.replaceState(null, "", location.pathname);
    await load();
    waitForApproval();
  } else {
    await load();
    if (data?.monzo.connected) sync(false, true);   // background top-up (at most every 15 minutes)
  }
})();

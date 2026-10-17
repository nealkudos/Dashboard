// Trading page: everything from the signal-copier bot, via /api/trading (signed-in only).
import { fetchTrading, esc, money, cls, when, fmtT, inPeriod, summary, curveSVG } from "./lib.js";

const $ = (id) => document.getElementById(id);
let days = 7, data = null, filter = "All", shown = 15;
try { days = +(localStorage.getItem("trading-days") || 7) || 7; } catch {}
const pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

document.querySelectorAll("#period button").forEach((b) => {
  b.classList.toggle("on", +b.dataset.d === days);
  b.onclick = () => {
    document.querySelectorAll("#period button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); days = +b.dataset.d; shown = 15;
    try { localStorage.setItem("trading-days", days); } catch {}
    load();
  };
});

async function load() {
  try {
    data = await fetchTrading(days === 1 ? 2 : days);
    $("err").hidden = true;
    render();
  } catch (e) {
    $("err").textContent = "⚠️ " + e.message;
    $("err").hidden = false;
  }
}

function render() {
  const a = data.account, cur = a.currency || "USD";
  $("acct").textContent = `${a.broker || ""} #${a.login || ""} · ${a.demo ? "Demo account" : "REAL account"}`;
  const pills = [a.dry_run ? `<span class="pill">🧪 Dry run</span>` : `<span class="pill live">● Live trading</span>`];
  if (a.paused) pills.push(`<span class="pill warn">⏸ Paused</span>`);
  if (a.loss_lock) pills.push(`<span class="pill warn">🛑 Daily loss limit hit</span>`);
  (a.paused_channels || []).forEach((c) => pills.push(`<span class="pill warn">⛔ ${esc(c)} paused</span>`));
  $("pills").innerHTML = pills.join("");

  const closed = inPeriod(data.closed, days);
  const s = summary(closed);
  const openPnl = data.open.reduce((x, t) => x + t.pnl, 0);
  const label = days === 1 ? "today" : `last ${days} days`;
  $("tiles").innerHTML = [
    ["Balance", money(a.balance, false), cur],
    ["Equity", money(a.equity, false), `open P/L <span class="${cls(openPnl)}">${money(openPnl)}</span>`],
    ["Profit " + label, `<span class="${cls(s.net)}">${money(s.net)}</span>`, pl(s.trades, "trade") + " closed"],
    ["Signals won", s.rate === null ? "–" : s.rate + "%", `${s.won} won · ${s.lost} lost · ${s.even} even`],
  ].map(([k, v, x]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${x}</div></div>`).join("");

  $("curveTitle").textContent = "Profit over time (" + label + ")";
  $("curve").innerHTML = curveSVG(closed);
  drawDaily(closed);
  drawSources(closed);
  drawOpen();
  drawTrades(closed);
  $("updated").textContent = "Updated " + new Date(data.updated).toLocaleTimeString("en-GB") + " · refreshes every minute";
}

function drawDaily(closed) {
  const by = {};
  closed.forEach((t) => { const d = when(t.closed); if (!d) return; const k = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); by[k] = (by[k] || 0) + t.pnl; });
  const ks = Object.keys(by);
  if (!ks.length) { $("daily").innerHTML = `<div class="empty">Nothing yet.</div>`; return; }
  const W = 360, H = 170, P = 10, top = 8, bot = H - 20, vals = ks.map((k) => by[k]);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals), span = hi - lo || 1, bw = (W - 2 * P) / ks.length;
  const mid = top + ((bot - top) * hi) / span;
  const bars = ks.map((k, i) => {
    const v = by[k], h = (Math.abs(v) / span) * (bot - top), x = P + i * bw + bw * 0.15, w = bw * 0.7, y = v >= 0 ? mid - h : mid;
    return `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(h, 1)}" rx="3" fill="${v >= 0 ? "var(--ok)" : "var(--danger)"}"><title>${k}: ${money(v)}</title></rect>` +
      (ks.length <= 10 ? `<text class="lbl" x="${x + w / 2}" y="${H - 4}" text-anchor="middle">${k}</text>` : "");
  }).join("");
  $("daily").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Profit by day"><line class="axis" x1="${P}" x2="${W - P}" y1="${mid}" y2="${mid}"/>${bars}</svg>`;
}

function drawSources(closed) {
  const by = {};
  closed.forEach((t) => { const s = (by[t.source] ||= { n: 0, sig: {}, net: 0 }); s.n++; s.net += t.pnl; s.sig[t.key] = (s.sig[t.key] || 0) + t.pnl; });
  const rows = Object.entries(by).map(([name, s]) => {
    const v = Object.values(s.sig), w = v.filter((x) => x > 0.5).length, l = v.filter((x) => x < -0.5).length;
    return { name, sigs: v.length, w, l, e: v.length - w - l, wr: w + l ? w / (w + l) : null, net: s.net, avg: s.net / v.length };
  }).sort((a, b) => b.net - a.net);
  if (!rows.length) { $("sources").innerHTML = `<div class="empty">No closed trades in this period.</div>`; return; }
  $("sources").innerHTML = rows.map((r) => `<div class="src">
      <div class="nm">${esc(r.name)}</div><div class="nt ${cls(r.net)}">${money(r.net)}</div>
      <div class="dt">${pl(r.sigs, "signal")} · ${r.w} won · ${r.l} lost${r.e ? ` · ${r.e} even` : ""}
        ${r.wr === null ? "" : `<span>${Math.round(r.wr * 100)}% <span class="bar"><i style="width:${Math.round(r.wr * 100)}%"></i></span></span>`}</div>
      <div class="pa">${money(r.avg)} / signal</div></div>`).join("");
}

function drawOpen() {
  const o = data.open, pend = data.pending ? `${data.pending} pending order${data.pending > 1 ? "s" : ""}` : "";
  if (!o.length) { $("open").innerHTML = `<div class="empty">No open trades${pend ? " · " + pend : ""}.</div>`; return; }
  $("open").innerHTML = o.map((t) => `<div class="trade"><div>
      <div class="t1"><span class="side-${t.side}">${t.side}</span> ${t.lots} lots <span class="tag">${esc(t.source)}</span></div>
      <div class="t2">${t.entry} → ${t.price} · SL ${t.sl ?? "–"} · TP ${t.tp ?? "–"} · ${fmtT(t.opened)}</div></div>
      <div class="p ${cls(t.pnl)}">${money(t.pnl)}</div></div>`).join("") + (pend ? `<div class="empty">${pend}</div>` : "");
}

function drawTrades(closed) {
  const sources = ["All", ...new Set(closed.map((t) => t.source))];
  if (!sources.includes(filter)) filter = "All";
  $("chips").innerHTML = sources.map((s) => `<button type="button" class="${s === filter ? "on" : ""}" data-s="${esc(s)}">${esc(s)}</button>`).join("");
  $("chips").querySelectorAll("button").forEach((b) => (b.onclick = () => { filter = b.dataset.s; shown = 15; drawTrades(closed); }));
  const list = closed.filter((t) => filter === "All" || t.source === filter).slice().reverse();
  if (!list.length) { $("trades").innerHTML = `<div class="empty">No closed trades in this period.</div>`; return; }
  $("trades").innerHTML = list.slice(0, shown).map((t) => `<div class="trade"><div>
      <div class="t1"><span class="side-${t.side}">${t.side}</span> ${t.lots} lots <span class="tag">${esc(t.source)}</span></div>
      <div class="t2">${t.entry} → ${t.exit} · ${esc(t.why)} · ${fmtT(t.closed)}</div></div>
      <div class="p ${cls(t.pnl)}">${money(t.pnl)}</div></div>`).join("") +
    (list.length > shown ? `<button class="more" type="button" id="more">Show more (${list.length - shown})</button>` : "");
  const m = $("more");
  if (m) m.onclick = () => { shown += 30; drawTrades(closed); };
}

load();
setInterval(load, 60000);

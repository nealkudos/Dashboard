// Trade HUD: a live, animated full-screen view of the bot's open trades (signed-in only).
// Same data as the Trading page: /api/trading-stream (live) + /api/trading (today's closed trades).
import { fetchTrading, fetchLive, esc, money, inPeriod, summary, account, setAccount } from "../lib.js";

const $ = (id) => document.getElementById(id);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let acct = account, es = null, streaming = false, lastOk = 0, lastBid = null, cur = "USD";
let known = new Map();            // open trade id -> last snapshot (to spot opens / closes)
let firstSnap = true;
const ticks = [];                 // [time, bid] for the trace

// ---------- boot sequence ----------
const bootLines = ["> INITIALISING TRADE OPS", "> LINKING TO SIGNAL COPIER…", "> MT5 BRIDGE ……… OK", "> PRICE FEED ……… XAUUSD", "> ALL SYSTEMS NOMINAL"];
(async () => {
  const pre = $("bootLog");
  if (reduce) { $("boot").classList.add("done"); return; }
  for (const l of bootLines) { pre.textContent += l + "\n"; await new Promise((r) => setTimeout(r, 260)); }
  setTimeout(() => $("boot").classList.add("done"), 300);
})();

// ---------- reactor tick marks ----------
(() => {
  const g = $("ticks"); let s = "";
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2, big = i % 10 === 0, r1 = big ? 166 : 170, r2 = 176;
    s += `<line class="${big ? "big" : ""}" x1="${200 + r1 * Math.cos(a)}" y1="${200 + r1 * Math.sin(a)}" x2="${200 + r2 * Math.cos(a)}" y2="${200 + r2 * Math.sin(a)}"/>`;
  }
  g.innerHTML = s;
})();
const ARC = 2 * Math.PI * 160;
$("plArc").style.strokeDasharray = `${ARC} ${ARC}`;
$("plArc").style.strokeDashoffset = ARC;

// ---------- clocks / session ----------
function tickClock() {
  const now = new Date();
  $("clkUk").textContent = now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  $("clkLocal").textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const h = +now.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false });
  const wd = now.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short" });
  $("session").textContent = wd === "Sat" || (wd === "Sun" && h < 23) ? "CLOSED" : h < 7 ? "ASIA" : h < 12 ? "LONDON" : h < 17 ? "NEW YORK" : h < 22 ? "LATE NY" : "ASIA";
}
setInterval(tickClock, 1000); tickClock();

// ---------- account switch ----------
function drawSwitch() {
  document.querySelectorAll("#acctSwitch button").forEach((b) => b.classList.toggle("on", b.dataset.a === acct));
  document.body.classList.toggle("real", acct === "live");
}
document.querySelectorAll("#acctSwitch button").forEach((b) => (b.onclick = () => {
  if (b.dataset.a === acct) return;
  acct = b.dataset.a; setAccount(acct); drawSwitch();
  known = new Map(); firstSnap = true; ticks.length = 0; lastBid = null;
  log(`SWITCHED TO ${acct === "live" ? "REAL-MONEY" : "DEMO"} ACCOUNT`);
  closeStream(); openStream(); liveTick(); loadToday();
}));
drawSwitch();
fetch("/api/trading-accounts", { credentials: "same-origin" }).then((r) => r.json()).then((b) => {
  if (!b?.data?.live) {
    const btn = $("acctSwitch").querySelector('[data-a="live"]'); btn.disabled = true;
    if (acct === "live") { acct = "demo"; setAccount("demo"); drawSwitch(); closeStream(); openStream(); loadToday(); }
  }
}).catch(() => {});

// ---------- event log ----------
function log(text, kind = "") {
  const li = document.createElement("li");
  const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  li.innerHTML = `<time>${t}</time><span class="${kind}">${esc(text)}</span>`;
  $("log").prepend(li);
  while ($("log").children.length > 60) $("log").lastChild.remove();
}

// ---------- today's closed trades ----------
async function loadToday() {
  try {
    const d = await fetchTrading(2, acct);
    if ((d.account_kind || "demo") !== acct) return;
    cur = d.account?.currency || cur;
    const s = summary(inPeriod(d.closed || [], 1));
    $("today").textContent = money(s.net) + " " + cur;
    $("today").className = s.net > 0.5 ? "up" : s.net < -0.5 ? "down" : "";
    $("todaySub").textContent = `${s.signals} SIGNALS · ${s.won}W ${s.lost}L${s.rate != null ? " · " + s.rate + "%" : ""}`;
  } catch (e) { $("todaySub").textContent = e.message.toUpperCase(); }
}

// ---------- positions ----------
const pct = (t) => {
  if (t.sl == null || t.tp == null || t.sl === t.tp) return null;
  const p = t.side === "BUY" ? (t.price - t.sl) / (t.tp - t.sl) : (t.sl - t.price) / (t.sl - t.tp);
  return Math.max(0, Math.min(1, p));
};
const G = 2 * Math.PI * 22;
function gaugeSVG() {
  return `<svg class="gauge" viewBox="0 0 54 54"><circle class="g-bg" cx="27" cy="27" r="22"/>
    <circle class="g-fg" cx="27" cy="27" r="22" transform="rotate(-90 27 27)" stroke-dasharray="${G} ${G}" stroke-dashoffset="${G}"/>
    <text x="27" y="27">--</text></svg>`;
}
function drawPositions(open) {
  const box = $("positions");
  const ids = new Set(open.map((t) => `${t.key}-${t.leg}`));
  // remove closed
  box.querySelectorAll(".pos").forEach((el) => {
    if (!ids.has(el.dataset.id) && !el.classList.contains("closing")) {
      el.classList.add("closing"); setTimeout(() => el.remove(), 800);
    }
  });
  box.querySelector(".empty")?.remove();
  open.forEach((t) => {
    const id = `${t.key}-${t.leg}`;
    let el = box.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "pos"; el.dataset.id = id;
      el.innerHTML = `${gaugeSVG()}<div><div class="p-main"><b class="${t.side}">${t.side}</b> ${t.lots} · ${esc(t.source || "")}</div><div class="p-sub"></div></div><div class="p-pl"></div>`;
      box.append(el);
    }
    const p = pct(t), fg = el.querySelector(".g-fg");
    fg.style.strokeDashoffset = p == null ? G : G * (1 - p);
    fg.style.stroke = p == null ? "var(--c)" : p > 0.66 ? "var(--up)" : p < 0.33 ? "var(--down)" : "var(--c)";
    el.querySelector("text").textContent = p == null ? "RUN" : Math.round(p * 100) + "%";
    el.querySelector(".p-sub").textContent = `IN ${t.entry} → ${t.price}  SL ${t.sl ?? "—"}  TP ${t.tp ?? "—"}`;
    const pl = el.querySelector(".p-pl");
    pl.textContent = money(t.pnl);
    pl.className = "p-pl " + (t.pnl > 0 ? "up" : t.pnl < 0 ? "down" : "");
  });
  if (!open.length && !box.querySelector(".pos")) box.innerHTML = `<div class="empty">NO OPEN POSITIONS</div>`;
  $("posCount").textContent = open.length ? `[${open.length}]` : "";
  $("count").textContent = `${open.length} OPEN`;
}

// ---------- live frame ----------
function frame(d) {
  lastOk = Date.now();
  $("linkDot").className = "blink on"; $("linkTxt").textContent = streaming ? "STREAMING" : "POLLING";
  const bid = d.bid;
  if (bid != null) {
    $("px").textContent = bid.toFixed(2);
    if (lastBid != null && bid !== lastBid) {
      const up = bid > lastBid, px = $("px");
      px.classList.remove("flash-up", "flash-down"); void px.offsetWidth;
      px.classList.add(up ? "flash-up" : "flash-down");
      $("move").textContent = (up ? "▲ " : "▼ ") + Math.abs(bid - lastBid).toFixed(2);
      $("move").className = "move " + (up ? "up" : "down");
    }
    lastBid = bid;
    ticks.push([Date.now(), bid]);
    const cut = Date.now() - 15 * 60e3;
    while (ticks.length && ticks[0][0] < cut) ticks.shift();
  }
  if (d.ask != null && bid != null) $("spread").textContent = (d.ask - bid).toFixed(2);
  const openPl = d.open.reduce((s, t) => s + (t.pnl || 0), 0);
  if (d.equity != null) $("equity").textContent = money(d.equity, false) + " " + cur;
  if (d.balance != null) $("balance").textContent = money(d.balance, false) + " " + cur;
  $("openPl").textContent = money(openPl) + " " + cur;
  $("openPl").className = openPl > 0 ? "up" : openPl < 0 ? "down" : "";
  // P/L arc: open P/L as a share of 1% of the balance (full ring = ±1%)
  const scale = Math.max(1, (d.balance || 1000) * 0.01), frac = Math.max(-1, Math.min(1, openPl / scale));
  $("plArc").style.strokeDashoffset = ARC * (1 - Math.abs(frac));
  $("plArc").style.stroke = frac >= 0 ? "var(--up)" : "var(--down)";

  // events: new / closed trades
  const now = new Map(d.open.map((t) => [`${t.key}-${t.leg}`, t]));
  if (!firstSnap) {
    for (const [id, t] of now) if (!known.has(id)) log(`OPENED ${t.side} ${t.lots} @ ${t.entry} · ${t.source || ""}`, t.side);
    for (const [id, t] of known) if (!now.has(id)) log(`CLOSED ${t.side} ${t.lots} · LAST ${money(t.pnl)} · ${t.source || ""}`, t.pnl >= 0 ? "up" : "down");
  } else {
    log(`LINK ESTABLISHED · ${d.open.length} OPEN · ${d.pending.length} PENDING`);
  }
  if (!firstSnap && [...known.keys()].some((k) => !now.has(k))) loadToday();
  known = now; firstSnap = false;

  drawPositions(d.open);
  $("pending").innerHTML = d.pending.length
    ? d.pending.map((o) => `<div>${o.side} ${esc(o.kind)} @ ${o.price} · ${esc(o.source || "")}</div>`).join("")
    : `<div class="empty">NONE</div>`;
  drawChart(d.open);
}

// ---------- price trace ----------
const cv = $("chart"), ctx = cv.getContext("2d");
function drawChart(open = []) {
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (ticks.length < 2) { ctx.fillStyle = "#2a6f82"; ctx.font = "11px monospace"; ctx.fillText("AWAITING TICKS…", 10, 20); return; }
  const levels = open.flatMap((t) => [t.entry]).filter((v) => v != null);
  let lo = Math.min(...ticks.map((t) => t[1])), hi = Math.max(...ticks.map((t) => t[1]));
  levels.forEach((v) => { if (Math.abs(v - (lo + hi) / 2) < (hi - lo) * 3 + 5) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  const pad = Math.max(0.5, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const t0 = ticks[0][0], t1 = Math.max(ticks[ticks.length - 1][0], t0 + 1);
  const X = (t) => ((t - t0) / (t1 - t0)) * (W - 50), Y = (v) => H - ((v - lo) / (hi - lo)) * H;
  // grid
  ctx.strokeStyle = "rgba(79,243,255,.08)"; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, (H * i) / 5); ctx.lineTo(W, (H * i) / 5); ctx.stroke(); }
  // entry lines
  ctx.setLineDash([4, 4]);
  open.forEach((t) => {
    if (t.entry == null || t.entry < lo || t.entry > hi) return;
    ctx.strokeStyle = t.side === "BUY" ? "rgba(61,255,168,.5)" : "rgba(255,77,106,.5)";
    ctx.beginPath(); ctx.moveTo(0, Y(t.entry)); ctx.lineTo(W - 50, Y(t.entry)); ctx.stroke();
  });
  ctx.setLineDash([]);
  // fill + line
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(79,243,255,.25)"); g.addColorStop(1, "rgba(79,243,255,0)");
  ctx.beginPath(); ticks.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
  ctx.lineTo(X(ticks[ticks.length - 1][0]), H); ctx.lineTo(X(t0), H); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ticks.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
  ctx.strokeStyle = "#4ff3ff"; ctx.lineWidth = 1.6; ctx.shadowColor = "#4ff3ff"; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
  // head + labels
  const [lt, lv] = ticks[ticks.length - 1];
  ctx.fillStyle = "#4ff3ff"; ctx.beginPath(); ctx.arc(X(lt), Y(lv), 3.5, 0, 7); ctx.fill();
  ctx.font = "10px monospace"; ctx.fillStyle = "#2a6f82";
  ctx.fillText(hi.toFixed(2), W - 46, 11); ctx.fillText(lo.toFixed(2), W - 46, H - 3);
  ctx.fillStyle = "#4ff3ff"; ctx.fillText(lv.toFixed(2), W - 46, Math.max(22, Math.min(H - 14, Y(lv) + 3)));
}
addEventListener("resize", () => drawChart([...known.values()]));

// ---------- stream (falls back to polling) ----------
function openStream() {
  if (!window.EventSource || es) return;
  es = new EventSource(acct === "live" ? "/api/trading-stream?account=live" : "/api/trading-stream");
  es.onmessage = (ev) => { try { streaming = true; frame(JSON.parse(ev.data)); } catch {} };
  es.onerror = () => { streaming = false; if (es && es.readyState === EventSource.CLOSED) { es = null; setTimeout(openStream, 5000); } };
}
function closeStream() { if (es) { es.close(); es = null; } streaming = false; }
async function liveTick() {
  if (document.visibilityState !== "visible" || streaming) return;
  try { frame(await fetchLive()); } catch (e) { $("linkDot").className = "blink bad"; $("linkTxt").textContent = "OFFLINE"; }
}
setInterval(() => {
  if (lastOk && Date.now() - lastOk > 20000) { $("linkDot").className = "blink bad"; $("linkTxt").textContent = "RECONNECTING"; }
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { closeStream(); openStream(); liveTick(); loadToday(); } else closeStream();
});
window.addEventListener("pageshow", (e) => { if (e.persisted) { closeStream(); openStream(); liveTick(); } });

openStream(); liveTick(); loadToday();
setInterval(liveTick, 5000);
setInterval(loadToday, 60000);

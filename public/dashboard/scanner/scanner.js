// Chart scanner page: trend per timeframe, strategy setups and their backtests, recent signals.
import { esc, fmtT } from "../trading/lib.js";
import { fetchScanner } from "./scanner-data.js";

const $ = (id) => document.getElementById(id);
const ARROW = { up: "▲", down: "▼", mixed: "◆" };
const WORD = { up: "Up", down: "Down", mixed: "Mixed" };
const RULES = {
  MT: "4h, 1h and 15m trends all agree (EMA50 vs EMA200), then a pullback to the 15m EMA50 that closes back with the trend. Stop 1.5× ATR, target 2× the risk.",
  TP: "15m uptrend (EMA50 above EMA200), price dips to EMA20 and closes back above with RSI over 50 (mirror for sells).",
  BB: "Price closes back inside the Bollinger band after a stretch, RSI extreme; targets the middle band.",
  NY: "Range of 13:00–14:30 UK; first 15m close outside it before 17:00 UK. Stop at the other side, target 1.5× the range.",
};


function render(d) {
  const st = d.state;
  if (st) {
    const b = st.bias;
    const msg = b === "up" ? "Bullish — all timeframes up" : b === "down" ? "Bearish — all timeframes down" : "Mixed — no clear trend";
    const sub = b === "up" ? "The EMA 50/200 strategy is looking for pullbacks to buy." :
      b === "down" ? "The EMA 50/200 strategy is looking for pullbacks to sell into." :
      "The EMA 50/200 strategy waits until 4h, 1h and 15m agree.";
    $("bias").className = "bias card " + b;
    $("bias").innerHTML = `<div class="ico">${ARROW[b]}</div>
      <div><div class="big">${msg}</div><div class="muted small">${sub}</div></div>
      <div class="px"><div class="muted small">${esc(d.symbol)}</div><b>${Number(st.price).toFixed(2)}</b>
        <div class="muted small">RSI ${st.rsi ?? "–"} · ATR ${st.atr ?? "–"}</div></div>`;
    $("tfs").innerHTML = st.timeframes.map((t) => {
      const tr = t.trend || "na";
      const gap = t.ema50 != null && t.ema200 != null ? (t.ema50 - t.ema200).toFixed(2) : null;
      return `<div class="tf"><div class="n">${t.tf}</div>
        <div class="t ${tr}">${t.trend ? ARROW[t.trend] + " " + WORD[t.trend] : "Warming up"}</div>
        <div class="e">EMA50 ${t.ema50 ?? "–"}<br>EMA200 ${t.ema200 ?? "–"}${gap ? `<br>Gap ${gap > 0 ? "+" : ""}${gap}` : ""}</div></div>`;
    }).join("");
  } else {
    $("bias").innerHTML = `<div class="muted small">Waiting for chart data…</div>`;
  }

  $("signals").innerHTML = d.signals.length ? d.signals.map((s) => `<div class="sig">
      <span class="side ${s.side}">${s.side}</span>
      <span class="w">${esc(s.setup)}${s.kind === "cross" ? ' <span class="tag">alert only</span>' : ""}</span>
      <span class="tm">${fmtT(s.time)}</span>
      ${s.kind === "trade" ? `<span class="d">Entry ${s.entry} · SL ${s.sl} · TP ${s.tp}</span>` : ""}
    </div>`).join("")
    : `<div class="empty">No signals yet since the bot last started. New ones appear here and on your phone.</div>`;

  $("range").textContent = d.backtest_range ? "· backtest " + d.backtest_range : d.tested_on ? "" : "· backtest runs when the market opens";
  const setups = d.setups.length ? d.setups : Object.entries(d.rules).map(([tag, name]) => ({ tag, name, pending: true }));
  $("setups").innerHTML = setups.map((s) => `<div class="setup">
      <div class="h"><span class="nm">${esc(s.name)}</span>
        ${s.pending ? `<span class="badge off">Not tested yet</span>` : `<span class="badge ${s.on ? "on" : "off"}">${s.on ? "ON · trading" : "OFF"}</span>`}</div>
      ${s.pending ? "" : `<div class="stats">
        <div>Trades<b>${s.n}</b></div><div>Win rate<b>${Math.round(s.rate)}%</b></div>
        <div>Profit factor<b>${s.pf >= 99 ? "–" : s.pf.toFixed(2)}</b></div>
        <div>Result<b class="${s.usd > 0 ? "up" : s.usd < 0 ? "down" : ""}">${s.usd > 0 ? "+" : ""}${Math.round(s.usd)}</b></div></div>`}
      <div class="why">${esc(RULES[s.tag] || "")}</div>
    </div>`).join("") +
    `<p class="muted small rule">A setup switches on only if its backtest had ${d.min_trades}+ trades, profit factor ${d.min_pf}+ and made money overall. Re-tested every Monday. Result is in USD at 0.03 lots, after spread.</p>`;

  $("updated").textContent = "Updated " + new Date(d.updated).toLocaleTimeString("en-GB") + " · refreshes every 30 seconds";
}

async function load() {
  try {
    render(await fetchScanner());
    $("err").hidden = true;
  } catch (e) {
    $("err").textContent = "⚠️ " + e.message;
    $("err").hidden = false;
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
load();
setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);

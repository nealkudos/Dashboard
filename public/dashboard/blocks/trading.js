// Trading summary — headline numbers from the signal-copier bot, with a link to the full Trading page.
import { fetchTrading, money, inPeriod, summary, curveSVG } from "../trading/lib.js";

const css = `
.tsum .row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:8px}
.tsum .k{font-size:12px;color:var(--muted)}
.tsum .v{font-size:19px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tsum .up{color:var(--ok)} .tsum .down{color:var(--danger)} .tsum .flat{color:var(--muted)}
.tsum .axis{stroke:var(--line);stroke-width:1}
.tsum .empty{color:var(--muted);font-size:13px;padding:6px 0}
.tsum .foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;font-size:13px}
.tsum a{color:var(--accent);font-weight:600;text-decoration:none}
.tsum .warn{color:var(--danger);font-size:12px}`;

export default {
  id: "trading",
  title: "Trading · last 7 days",
  size: "m",

  async render(el, ctx) {
    el.innerHTML = `<style>${css}</style><div class="tsum"><div class="muted small">Loading…</div></div>`;
    const box = el.querySelector(".tsum");
    const cls = (v) => (v > 0.5 ? "up" : v < -0.5 ? "down" : "flat");

    ctx.every(60000, async () => {
      try {
        const d = await fetchTrading(7);
        const closed = inPeriod(d.closed, 7), s = summary(closed);
        const open = d.open.reduce((x, t) => x + t.pnl, 0);
        const warn = [d.account.loss_lock && "Daily loss limit hit", d.account.paused && "Bot paused",
          ...(d.account.paused_channels || []).map((c) => c + " paused")].filter(Boolean);
        box.innerHTML = `
          <div class="row">
            <div><div class="k">Profit</div><div class="v ${cls(s.net)}">${money(s.net)}</div></div>
            <div><div class="k">Signals won</div><div class="v">${s.rate === null ? "–" : s.rate + "%"}</div></div>
            <div><div class="k">Open (${d.open.length})</div><div class="v ${cls(open)}">${d.open.length ? money(open) : "–"}</div></div>
          </div>
          ${curveSVG(closed, { W: 360, H: 90, labels: false })}
          <div class="foot">
            <span class="muted">Balance ${money(d.account.balance, false)} ${d.account.currency || ""}${d.account.demo ? " · demo" : ""}</span>
            <a href="/dashboard/trading/">Open trading →</a>
          </div>
          ${warn.length ? `<div class="warn">⚠️ ${warn.join(" · ")}</div>` : ""}`;
      } catch (e) {
        box.innerHTML = `<div class="muted small">⚠️ ${e.message}</div>
          <div class="foot"><span></span><a href="/dashboard/trading/">Open trading →</a></div>`;
      }
    });
  },
};

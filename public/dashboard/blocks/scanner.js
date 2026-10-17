// Chart scanner summary — overall trend, each timeframe, latest signal; links to the full Scanner page.
import { fetchScanner } from "../scanner/scanner-data.js";

const css = `
.scn .bias{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.scn .ico{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:19px;flex:none;background:var(--surface-2);color:var(--muted)}
.scn .up .ico{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}
.scn .down .ico{background:color-mix(in srgb,var(--danger) 16%,transparent);color:var(--danger)}
.scn .big{font-weight:700;font-size:17px;line-height:1.2}
.scn .tfs{display:flex;gap:6px;margin-bottom:10px}
.scn .tf{flex:1;background:var(--surface-2);border-radius:9px;padding:6px 8px;font-size:12px;color:var(--muted)}
.scn .tf b{display:block;font-size:14px}
.scn .tf b.up{color:var(--ok)} .scn .tf b.down{color:var(--danger)} .scn .tf b.mixed{color:var(--muted)}
.scn .last{font-size:13px;color:var(--muted);margin-bottom:6px}
.scn a{color:var(--accent);font-weight:600;text-decoration:none;font-size:13px}`;
const A = { up: "▲", down: "▼", mixed: "◆" };

export default {
  id: "scanner",
  title: "Chart scanner",
  size: "s",

  async render(el, ctx) {
    el.innerHTML = `<style>${css}</style><div class="scn"><div class="muted small">Loading…</div></div>`;
    const box = el.querySelector(".scn");
    ctx.every(60000, async () => {
      try {
        const d = await fetchScanner();
        const st = d.state;
        const b = st ? st.bias : "mixed";
        const word = b === "up" ? "Bullish" : b === "down" ? "Bearish" : "Mixed";
        const sig = d.signals.find((s) => s.kind === "trade");
        box.innerHTML = `
          <div class="bias ${b}"><div class="ico">${A[b]}</div>
            <div><div class="big">${word}</div><div class="muted small">XAUUSD ${st ? Number(st.price).toFixed(2) : ""}</div></div></div>
          <div class="tfs">${(st ? st.timeframes : []).map((t) =>
            `<div class="tf">${t.tf}<b class="${t.trend || ""}">${t.trend ? A[t.trend] : "…"}</b></div>`).join("")}</div>
          <div class="last">${sig ? `Last: <b>${sig.side}</b> · ${sig.setup}` : "No signals yet"}</div>
          <a href="/dashboard/scanner/">Open scanner →</a>`;
      } catch (e) {
        box.innerHTML = `<div class="muted small">⚠️ ${e.message}</div><a href="/dashboard/scanner/">Open scanner →</a>`;
      }
    });
  },
};

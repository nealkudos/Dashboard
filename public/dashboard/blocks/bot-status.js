// Small status light for the trading bot: is everything running?
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLOR = { ok: "var(--ok)", warn: "#d9a21b", down: "var(--danger)" };
const HEAD = { ok: "All running", warn: "Needs a look", down: "Problem" };

function uptime(sec) {
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min`;
  if (sec < 172800) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} days`;
}
const dot = (state, size = 9) =>
  `<span style="flex:none;width:${size}px;height:${size}px;border-radius:50%;background:${COLOR[state]};${state === "ok" ? "" : `box-shadow:0 0 0 3px color-mix(in srgb, ${COLOR[state]} 25%, transparent)`}"></span>`;

export default {
  id: "bot-status",
  title: "Trading bot",
  size: "s",

  render(el, ctx) {
    el.innerHTML = `<div data-out class="small muted">Checking…</div>`;
    const out = el.querySelector("[data-out]");

    async function check() {
      let h;
      try {
        h = (await ctx.api("/api/trading-health")).data;
      } catch (e) {
        const msg = /404/.test(e.message) ? "The bot needs updating to report its status." :
          /isn't connected yet/.test(e.message) ? e.message : e.message;
        out.className = "";
        out.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px">${dot("down", 12)}
            <div style="font-weight:650;font-size:17px">Offline</div></div>
          <div class="small muted" style="margin-top:6px">${esc(msg)}</div>
          <div class="small muted" style="margin-top:8px">Checked ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>`;
        return;
      }
      out.className = "";
      out.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">${dot(h.overall, 12)}
          <div style="font-weight:650;font-size:17px">${HEAD[h.overall] || h.overall}</div>
          <span class="small" style="margin-left:auto;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:${h.mode === "live" ? "var(--danger)" : "var(--muted)"}">${h.mode === "live" ? "LIVE" : "Dry run"}</span>
        </div>
        <div style="display:grid;gap:5px;margin-top:10px">
          ${h.checks.map((c) => `
            <div style="display:flex;align-items:center;gap:8px;font-size:14px" title="${esc(c.detail)}">
              ${dot(c.state, 8)}<span style="flex:1;min-width:0;white-space:nowrap">${esc(c.label)}</span>
              <span class="small muted" style="text-align:right;max-width:60%;overflow-wrap:anywhere">${esc(c.detail)}</span>
            </div>`).join("")}
        </div>
        ${h.notes.map((n) => `<div class="small" style="margin-top:8px;color:#d9a21b">⚠️ ${esc(n)}</div>`).join("")}
        <div class="small muted" style="margin-top:10px;line-height:1.5">
          Up ${uptime(h.uptime_sec)} · ${h.stats.signals} signal${h.stats.signals === 1 ? "" : "s"} today${h.stats.errors ? ` · <span style="color:var(--danger)">${h.stats.errors} error${h.stats.errors === 1 ? "" : "s"}</span>` : ""}<br>
          Last signal: ${h.last_signal ? `${esc(h.last_signal.channel)}, ${esc(h.last_signal.ago)}` : "none since restart"}
        </div>`;
    }
    ctx.every(30000, check);
  },
};

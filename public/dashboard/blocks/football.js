// Football predictions — this week's Premier League picks. The data file
// (/dashboard/football/picks.json) is rewritten every Friday morning by the
// "Weekend football picks" scheduled task, which commits it to this repo.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const css = `
.fb{display:grid;gap:6px}
.fb .row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--surface-2)}
.fb .pick{font-weight:600;font-size:15px}
.fb .sub{font-size:12px;color:var(--muted)}
.fb .p{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}
.fb .foot{font-size:12px;color:var(--muted);margin-top:2px}`;

const when = (iso) => { const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };

export default {
  id: "football",
  title: "Football predictions",
  size: "s",

  async render(el, ctx) {
    el.innerHTML = `<style>${css}</style><div class="fb"><div class="muted small">Loading…</div></div>`;
    const box = el.querySelector(".fb");

    ctx.every(15 * 60000, async () => {
      let d;
      try {
        const r = await fetch("/dashboard/football/picks.json?t=" + Date.now(), { credentials: "same-origin" });
        if (!r.ok) throw new Error("Couldn't load predictions (" + r.status + ")");
        d = await r.json();
      } catch (e) { box.innerHTML = `<div class="muted small">⚠️ ${esc(e.message)}</div>`; return; }

      const cutoff = Date.now() - 2 * 3600e3; // drop a pick once its game is over
      const picks = (d.picks || []).filter((p) => !p.kickoff || new Date(p.kickoff).getTime() > cutoff)
        .sort((a, b) => b.prob - a.prob);
      const rec = d.record || {}, total = (rec.won || 0) + (rec.lost || 0);

      box.innerHTML = (picks.map((p) => `
        <div class="row"><div><div class="pick">${esc(p.pick)}</div>
          <div class="sub">${esc(p.match)}${p.kickoff ? " · " + when(p.kickoff) : ""}</div></div>
          <div class="p">${Math.round(p.prob)}%</div></div>`).join("")
        || `<div class="muted small">No predictions right now. New ones arrive Friday morning.</div>`) + `
        <div class="foot">${total ? `Record: ${rec.won} won, ${rec.lost} lost (${Math.round(100 * rec.won / total)}%) · ` : ""}% = chance the pick lands</div>`;
    });
  },
};

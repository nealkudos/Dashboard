// The holiday you're on (or the next one): spent against budget, with a quick way in to add expenses.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gbp0 = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(Math.round(n)).toLocaleString("en-GB");

export default {
  id: "holiday",
  title: "Holiday budget",
  size: "m",

  async render(el, ctx) {
    const { holidays } = await ctx.api("/api/holidays");
    const t = new Date().toLocaleDateString("en-CA");
    const now = holidays.find((h) => h.start && h.end && h.start <= t && t <= h.end);
    const next = holidays.filter((h) => h.start && h.start > t).sort((a, b) => a.start.localeCompare(b.start))[0];
    const h = now || next || holidays[0];
    if (!h) {
      el.innerHTML = `<div class="muted small">No holidays yet.</div><a class="btn" style="margin-top:10px" href="/dashboard/holidays/">Make a holiday budget</a>`;
      return;
    }
    const pct = h.budget ? Math.min(100, (h.spent / h.budget) * 100) : 0;
    const when = now ? "Away now" : next === h ? `In ${Math.round((Date.parse(h.start) - Date.parse(t)) / 86400000)} days` : "Last trip";
    el.innerHTML = `
      <a href="/dashboard/holidays/?h=${esc(h.id)}" style="display:block;color:inherit;text-decoration:none">
        <div style="display:flex;align-items:center;gap:10px"><span style="font-size:26px">${esc(h.emoji || "🌴")}</span>
          <div style="flex:1;min-width:0"><b>${esc(h.name)}</b><div class="muted small">${esc(when)}${h.place ? ` · ${esc(h.place)}` : ""}</div></div>
          <div style="text-align:right"><b style="font-size:20px">${gbp0(h.spent)}</b><div class="muted small">${h.budget ? `of ${gbp0(h.budget)}` : "spent"}</div></div></div>
        ${h.budget ? `<div style="height:8px;border-radius:4px;background:var(--surface-2);margin-top:12px;overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:${pct > 100 ? "var(--danger)" : "var(--accent)"};border-radius:4px"></i></div>
          <div class="muted small" style="margin-top:6px">${h.left >= 0 ? `${gbp0(h.left)} left` : `${gbp0(-h.left)} over budget`}</div>` : ""}
      </a>
      <a class="btn" style="margin-top:12px" href="/dashboard/holidays/?h=${esc(h.id)}">Add an expense</a>`;
  },
};

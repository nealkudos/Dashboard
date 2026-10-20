// Budget summary block: this month's money in / spent / left and the top categories.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gbp = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 });

export default {
  id: "budget",
  title: "Budget",
  size: "m",

  render(el, ctx) {
    el.innerHTML = `<div class="small muted">Loading…</div>`;
    async function draw() {
      let d;
      try { d = await ctx.api("/api/budget/summary"); }
      catch (e) { el.innerHTML = `<div class="small muted">⚠️ ${esc(e.message)}</div>`; return; }
      const monthName = new Date(d.month + "-01T12:00:00").toLocaleDateString("en-GB", { month: "long" });
      if (!d.connections.length) {
        el.innerHTML = `<div class="small muted">${d.configured ? "No banks connected yet." : "Bank linking isn't set up yet."}</div>
          <a href="/dashboard/budget/" class="link small" style="display:inline-block;margin-top:8px;color:var(--accent);font-weight:600;text-decoration:none">Open budget →</a>`;
        return;
      }
      const t = d.totals;
      const top = d.categories.slice(0, 4);
      const max = Math.max(...top.map((c) => c.budget || c.spent), 1);
      const expiring = d.connections.filter((c) => c.days_left < 7);
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
          <div><div class="small muted">In · ${esc(monthName)}</div><div style="font-size:20px;font-weight:650;color:var(--ok)">${gbp(t.income)}</div></div>
          <div><div class="small muted">Spent</div><div style="font-size:20px;font-weight:650">${gbp(t.spent)}</div></div>
          <div><div class="small muted">Left</div><div style="font-size:20px;font-weight:650;color:${t.left >= 0 ? "var(--ok)" : "var(--danger)"}">${gbp(t.left)}</div></div>
        </div>
        <div style="display:grid;gap:7px;margin-top:12px">
          ${top.map((c) => {
            const over = c.budget && c.spent > c.budget;
            return `<div><div style="display:flex;font-size:14px"><span style="flex:1">${esc(c.name)}</span>
              <span style="font-variant-numeric:tabular-nums">${gbp(c.spent)}${c.budget ? `<span class="muted"> / ${gbp(c.budget)}</span>` : ""}</span></div>
              <div style="height:5px;border-radius:3px;background:var(--surface-2);overflow:hidden;margin-top:3px">
                <i style="display:block;height:100%;width:${Math.min(100, (c.spent / (c.budget || max)) * 100)}%;background:${over ? "var(--danger)" : "var(--accent)"}"></i></div></div>`;
          }).join("") || `<div class="small muted">No spending yet this month.</div>`}
        </div>
        ${expiring.map((c) => `<div class="small" style="margin-top:8px;color:var(--danger)">⚠️ ${esc(c.bank)} access ${c.days_left < 0 ? "has expired" : `expires in ${c.days_left} days`} — reconnect</div>`).join("")}
        <a href="/dashboard/budget/" style="display:inline-block;margin-top:10px;color:var(--accent);font-weight:600;font-size:14px;text-decoration:none">Open budget →</a>`;
    }
    ctx.every(10 * 60 * 1000, draw);
  },
};

// Money trends: spending vs income over the last 6 budget months, and where this month's money went.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gbp0 = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(Math.round(n)).toLocaleString("en-GB");
const k = (n) => (Math.abs(n) >= 1000 ? `£${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `£${Math.round(n)}`);
const COLOR = {
  Groceries: "#3fa66b", "Eating out": "#e8833a", Transport: "#3b82c4", Fuel: "#8a6d3b", Bills: "#7c5cc4", Housing: "#c4513b",
  Subscriptions: "#c43b8f", Shopping: "#d9a21b", Health: "#2fa3a3", Family: "#e06c9f", Entertainment: "#5c6bc4", Travel: "#1f9fd1",
  Cash: "#6b8e23", Fees: "#8c8c8c", Other: "#9aa0a6",
};

function bars(months) {
  const W = 520, H = 190, padL = 50, padB = 24, padT = 10;
  const max = Math.max(100, ...months.flatMap((m) => [m.spent, m.income])) * 1.1;
  const step = (W - padL) / months.length, bw = Math.min(26, step * 0.32);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => max * f);
  let g = ticks.map((t) => `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="gl"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${k(t)}</text>`).join("");
  months.forEach((m, i) => {
    const cx = padL + step * i + step / 2;
    const name = new Date(m.month + "-01T12:00:00").toLocaleDateString("en-GB", { month: "short" });
    const cur = i === months.length - 1;
    g += `<rect x="${cx - bw - 2}" y="${y(m.income)}" width="${bw}" height="${Math.max(0, y(0) - y(m.income))}" rx="5" class="b-in"><title>${name}: ${gbp0(m.income)} in</title></rect>`;
    g += `<rect x="${cx + 2}" y="${y(m.spent)}" width="${bw}" height="${Math.max(0, y(0) - y(Math.max(0, m.spent)))}" rx="5" class="b-out${cur ? " cur" : ""}"><title>${name}: ${gbp0(m.spent)} spent</title></rect>`;
    g += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="ax${cur ? " axb" : ""}">${name}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Income and spending by month">${g}</svg>`;
}

function donut(cats, total, budget) {
  const R = 54, C = 2 * Math.PI * R;
  let off = 0, arcs = "";
  for (const c of cats) {
    const len = (c.spent / total) * C;
    arcs += `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${COLOR[c.name] || "#9aa0a6"}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(c.name)}: ${gbp0(c.spent)}</title></circle>`;
    off += len;
  }
  const centre = budget ? `${Math.round((total / budget) * 100)}%` : k(total);
  return `<svg viewBox="0 0 140 140" class="donut"><circle r="${R}" cx="70" cy="70" fill="none" class="track" stroke-width="16"/>${arcs}
    <text x="70" y="68" text-anchor="middle" class="d-big">${centre}</text><text x="70" y="86" text-anchor="middle" class="d-small">${budget ? "of budget" : "spent"}</text></svg>`;
}

export default {
  id: "insights",
  title: "Money trends",
  size: "l",

  async render(el, ctx) {
    el.innerHTML = `<div class="muted small">Loading…</div>`;
    const [tr, sum] = await Promise.all([ctx.api("/api/budget/trend?n=6"), ctx.api("/api/budget/summary")]);
    const cats = sum.categories.filter((c) => c.spent > 0.5);
    const total = cats.reduce((s, c) => s + c.spent, 0);
    const avg = tr.months.slice(0, -1).reduce((s, m) => s + m.spent, 0) / Math.max(1, tr.months.length - 1);
    el.innerHTML = `
      <div class="ins">
        <div class="ins-main">
          <div class="ins-h"><div><b>Income vs spending</b><small>Last 6 ${tr.payday ? "pay months" : "months"} · average spend ${gbp0(avg)}</small></div>
            <div class="legend"><span><i class="lg-in"></i>In</span><span><i class="lg-out"></i>Spent</span></div></div>
          ${bars(tr.months)}
        </div>
        <div class="ins-side">
          <div class="ins-h"><div><b>Where it went</b><small>This month</small></div></div>
          ${total ? `<div class="donut-wrap">${donut(cats, total, sum.totals.budget)}</div>
          <div class="ins-list">${cats.slice(0, 4).map((c) => `<div><i style="background:${COLOR[c.name] || "#9aa0a6"}"></i><span>${esc(c.name)}</span><b>${gbp0(c.spent)}</b></div>`).join("")}</div>`
            : `<div class="muted small">No spending yet this month.</div>`}
        </div>
      </div>`;
  },
};

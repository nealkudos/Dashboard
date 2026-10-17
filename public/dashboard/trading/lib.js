// Shared by the Trading page and the Trading summary block.

export async function fetchTrading(days) {
  const res = await fetch(`/api/trading?days=${days}`, { credentials: "same-origin" });
  if (res.status === 401) { location.replace("/"); throw new Error("Signed out"); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.error || `Error ${res.status}`);
  return body.data;
}

export async function fetchLive() {
  const res = await fetch("/api/trading-live", { credentials: "same-origin" });
  if (res.status === 401) { location.replace("/"); throw new Error("Signed out"); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.error || `Error ${res.status}`);
  return body.data;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = (v, sign = true) =>
  (sign && v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const cls = (v) => (v > 0.5 ? "up" : v < -0.5 ? "down" : "flat");
export const when = (s) => { const d = new Date(String(s).replace(" ", "T")); return isNaN(d) ? null : d; };
export const fmtT = (s) => {
  const d = when(s);
  return d ? d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
};

/** Closed trades inside the period (days=1 means today, local time). */
export function inPeriod(closed, days) {
  const now = new Date();
  return closed.filter((t) => {
    const d = when(t.closed);
    if (!d) return false;
    return days === 1 ? d.toDateString() === now.toDateString() : now - d <= days * 864e5;
  });
}

/** Headline numbers. A "signal" = all the trades opened from one message. */
export function summary(closed) {
  const sigs = {};
  closed.forEach((t) => { (sigs[t.key] ||= { pnl: 0 }).pnl += t.pnl; });
  const list = Object.values(sigs);
  const won = list.filter((s) => s.pnl > 0.5).length, lost = list.filter((s) => s.pnl < -0.5).length;
  return {
    net: closed.reduce((s, t) => s + t.pnl, 0), trades: closed.length, signals: list.length,
    won, lost, even: list.length - won - lost, rate: won + lost ? Math.round((100 * won) / (won + lost)) : null,
  };
}

/** Cumulative-profit line as an SVG string. */
export function curveSVG(closed, { W = 360, H = 170, labels = true } = {}) {
  if (!closed.length) return `<div class="empty">No closed trades in this period.</div>`;
  const P = labels ? 34 : 4;
  let c = 0;
  const pts = [[0, 0]];
  closed.forEach((t, i) => { c += t.pnl; pts.push([i + 1, c]); });
  const ys = pts.map((p) => p[1]), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = hi - lo || 1;
  const bottom = labels ? H - 22 : H - 4;
  const X = (i) => P + ((W - P - 8) * i) / (pts.length - 1), Y = (v) => 8 + (bottom - 8) * (1 - (v - lo) / span);
  const d = pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
  const last = ys[ys.length - 1], col = last >= 0 ? "var(--ok)" : "var(--danger)";
  const area = d + `L${X(pts.length - 1)} ${Y(0)}L${X(0)} ${Y(0)}Z`;
  const lbl = (v) => (labels && Math.abs(Y(v) - Y(0)) > 14 ? `<text class="lbl" x="${P - 5}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>` : "");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative profit">
    <line class="axis" x1="${P}" x2="${W - 8}" y1="${Y(0)}" y2="${Y(0)}"/>
    ${lbl(hi)}${lbl(lo)}${labels ? `<text class="lbl" x="${P - 5}" y="${Y(0) + 4}" text-anchor="end">0</text>` : ""}
    <path d="${area}" fill="${col}" opacity=".10"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="${X(pts.length - 1)}" cy="${Y(last)}" r="3.5" fill="${col}"/>
    ${labels ? `<text class="lbl" x="${W - 8}" y="${H - 4}" text-anchor="end">${closed.length} trades</text>` : ""}</svg>`;
}

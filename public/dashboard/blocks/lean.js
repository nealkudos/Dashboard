// Lean 12 weight loss programme — the daily check-in, right on the dashboard.
// Weigh in and tick today's habits here; the full programme lives at /dashboard/lean/.
import * as L from "../lean/lib.js";
const { esc, today } = L;

const CSS = `
.lean-top{display:flex;align-items:center;gap:12px}
.lean-top .wk{flex:1;min-width:0}.lean-top .wk b{display:block;font-size:16px}.lean-top .wk small{color:var(--muted);font-size:12.5px}
.lean-top .st{text-align:right;font-weight:700;font-size:18px;font-variant-numeric:tabular-nums}.lean-top .st small{display:block;font-size:11px;color:var(--muted);font-weight:500}
.lean-ring{--p:0;width:44px;height:44px;border-radius:50%;flex:none;background:conic-gradient(var(--ok) calc(var(--p)*1%),var(--surface-2) 0);display:grid;place-items:center}
.lean-ring span{width:34px;height:34px;border-radius:50%;background:var(--surface);display:grid;place-items:center;font-size:11px;font-weight:750}
.lean-wt{display:flex;gap:8px;align-items:center;margin-top:12px}
.lean-wt input{flex:1;min-width:0;padding:9px 12px;font:inherit;font-size:17px;font-weight:650;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:var(--text)}
.lean-wt button{padding:9px 14px}
.lean-wt .done{flex:1;font-size:14px}.lean-wt .done b{font-size:17px}
.lean-habs{display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));gap:6px;margin-top:10px}
.lean-habs button{background:var(--surface-2);color:var(--text);display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 2px;font-size:10.5px;font-weight:550;border-radius:12px;line-height:1.2;text-align:center;border:1.5px solid transparent}
.lean-habs button span{font-size:19px}
.lean-habs button.on{background:color-mix(in srgb,var(--ok) 22%,var(--surface-2));border-color:var(--ok)}
.lean-foot{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:13px}
.lean-foot svg{flex:1;height:28px;min-width:0}
.lean-foot a{color:var(--accent);text-decoration:none;font-weight:600;white-space:nowrap}`;
const SHORT = { water: "Water", protein: "Protein", steps: "Steps", kitchen: "Kitchen shut", gym: "Gym", drinks: "Zero sugar", veg: "Veg", sleep: "Bed by 11" };

function spark(doc) {
  const s = L.trendSeries(doc).slice(-30);
  if (s.length < 2) return `<span class="muted" style="flex:1">Trend line appears after a few weigh-ins</span>`;
  const vs = s.map((p) => p.t), lo = Math.min(...vs) - 0.2, hi = Math.max(...vs) + 0.2, W = 200, H = 28;
  const pts = s.map((p, i) => `${((i / (s.length - 1)) * W).toFixed(1)},${(H - 2 - ((p.t - lo) / (hi - lo)) * (H - 4)).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

export default {
  id: "lean",
  title: "Lean 12",
  size: "m",

  async render(el, ctx) {
    if (!document.getElementById("lean-css")) {
      const st = document.createElement("style"); st.id = "lean-css"; st.textContent = CSS; document.head.append(st);
    }
    let doc = await ctx.load(null), editing = false;

    const draw = () => {
      if (!doc?.profile) {
        el.innerHTML = `<div class="muted small">A 12-week weight loss programme built on small daily habits — no calorie counting. Check in here in 20 seconds a day.</div>
          <a class="btn" style="margin-top:12px" href="/dashboard/lean/">Start the programme</a>`;
        return;
      }
      const d = today();
      if (L.daysBetween(doc.profile.start, d) < 0) {
        el.innerHTML = `<div class="muted small">Week 1 starts ${L.fmtDay(doc.profile.start, { weekday: "long", day: "numeric", month: "short" })}.</div><a class="btn" style="margin-top:12px" href="/dashboard/lean/?tab=plan">See the plan</a>`;
        return;
      }
      const wk = L.weekOf(doc, d), e = L.entry(doc, d), plan = L.PLAN[wk - 1];
      const score = Math.round((L.dayScore(doc, d) ?? 0) * 100), streak = L.streak(doc), tr = L.trendAt(doc, d);
      const habits = L.activeHabits(wk).filter((h) => h.id !== "weigh");
      const gymN = L.gymThisWeek(doc, d);
      el.innerHTML = `
        <div class="lean-top">
          <div class="lean-ring" style="--p:${score}"><span>${score}%</span></div>
          <div class="wk"><b>Week ${wk} · ${esc(plan.title)}</b><small>${esc(L.nudge(doc))}</small></div>
          <div class="st">🔥 ${streak}<small>day streak</small></div>
        </div>
        <div class="lean-wt">${e.kg != null && !editing
          ? `<div class="done">⚖️ <b>${e.kg.toFixed(1)} kg</b> <span class="muted">· trend ${tr != null ? tr.toFixed(1) : "–"} · ${L.signed((tr ?? doc.profile.startKg) - doc.profile.startKg)} total</span></div><button class="ghost icon" data-edit type="button">Edit</button>`
          : `<input type="number" step="0.1" min="35" max="300" inputmode="decimal" placeholder="Today's weight (kg)" value="${e.kg ?? ""}" data-kg><button data-save type="button">Save</button>`}</div>
        <div class="lean-habs">${habits.map((h) => {
          const on = (e.h || []).includes(h.id);
          const label = h.perWeek ? `Gym ${gymN}/${h.perWeek}` : SHORT[h.id] || h.name;
          return `<button class="${on ? "on" : ""}" data-h="${h.id}" type="button" title="${esc(h.name)}"><span>${h.icon}</span>${esc(label)}</button>`;
        }).join("")}</div>
        <div class="lean-foot">${spark(doc)}<a href="/dashboard/lean/">Open ›</a></div>`;

      const kg = el.querySelector("[data-kg]");
      const saveKg = async () => {
        const v = parseFloat(kg.value);
        if (isNaN(v) || v < 35 || v > 300) { kg.focus(); return; }
        L.setWeight(doc, d, v); editing = false; draw(); await ctx.save(doc);
      };
      if (kg) { el.querySelector("[data-save]").onclick = saveKg; kg.onkeydown = (ev) => ev.key === "Enter" && saveKg(); }
      const ed = el.querySelector("[data-edit]");
      if (ed) ed.onclick = () => { editing = true; draw(); el.querySelector("[data-kg]")?.focus(); };
      el.querySelectorAll("[data-h]").forEach((b) => (b.onclick = async () => {
        const on = L.toggleHabit(doc, d, b.dataset.h);
        if (!on && b.dataset.h === "gym") delete doc.days[d].w;
        draw(); await ctx.save(doc);
      }));
    };

    draw();
    // Re-read every 10 minutes so ticks made on the phone show up, and roll over at midnight.
    let first = true;
    ctx.every(10 * 60 * 1000, async () => {
      if (first) { first = false; return; }
      if (el.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
      doc = await ctx.load(doc); draw();
    });
  },
};

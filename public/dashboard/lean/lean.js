// Lean 12 — a 12-week, habit-based weight loss programme. No calorie counting:
// a 20-second daily check-in, one new habit a week, short home-gym circuits.
import * as L from "./lib.js";
const { esc, today, addDays, fmtDay, daysBetween } = L;
const $ = (id) => document.getElementById(id);

let doc = null, tab = "today", viewDate = today();

// ---------- storage ----------
async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", headers: opts.body ? { "content-type": "application/json" } : {}, ...opts });
  if (res.status === 401) { location.replace("/"); throw new Error("Signed out"); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error || `Error ${res.status}`);
  return d;
}
let saveT, saving = Promise.resolve();
function save(now = false) {
  clearTimeout(saveT);
  const run = () => (saving = saving.then(() => api(L.STORE, { method: "PUT", body: JSON.stringify({ data: doc }) })).catch((e) => showErr("Couldn't save: " + e.message)));
  if (now) return run();
  saveT = setTimeout(run, 400);
}
let msgT;
function showOk(m) { $("okmsg").textContent = m; $("okmsg").hidden = false; $("err").hidden = true; clearTimeout(msgT); msgT = setTimeout(() => ($("okmsg").hidden = true), 3000); }
function showErr(m) { $("err").textContent = m; $("err").hidden = false; }

// ---------- shell ----------
function show(t) {
  tab = t;
  document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  for (const s of ["today", "progress", "workouts", "plan"]) $("tab-" + s).hidden = s !== t;
  ({ today: renderToday, progress: renderProgress, workouts: renderWorkouts, plan: renderPlan })[t]();
  window.scrollTo(0, 0);
}
$("tabbar").onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) show(b.dataset.tab); };
$("settings").onclick = () => setupSheet(true);

function started() {
  $("welcome").hidden = true; $("tabbar").hidden = false; $("settings").hidden = false;
  show(tab);
}

// ---------- welcome + setup ----------
function renderWelcome() {
  $("welcome").hidden = false; $("tabbar").hidden = true;
  $("welcome").innerHTML = `<div class="welcome">
    <div class="hero"><div class="phase">12 weeks · no calorie counting</div><div class="wk">Lean 12</div>
      <div class="nudge">Built to stick: a 20-second check-in on your dashboard each day, and one new habit a week.</div></div>
    <div class="card"><ol>
      <li><b>Weeks 1–4 · Foundations.</b> Weigh-ins, water, protein, steps, a closed kitchen after dinner.</li>
      <li><b>Weeks 5–8 · Build.</b> 20-minute home gym circuits, zero-sugar drinks, more veg, better sleep.</li>
      <li><b>Weeks 9–12 · Push.</b> 10k steps, four sessions a week, planning the hard days.</li>
    </ol>
    <p class="small">Tick habits straight from the dashboard block. A day counts towards your streak when you hit 70% of the day's habits — perfect isn't required.</p></div>
    <button class="full" id="go" type="button">Set up my programme</button></div>`;
  $("go").onclick = () => setupSheet(false);
}

function setupSheet(editing) {
  const p = doc?.profile || {};
  const dlg = $("dlg");
  dlg.innerHTML = `<form method="dialog" id="f">
    <h3>${editing ? "Programme settings" : "Your starting point"}</h3>
    <div class="two-col">
      <label class="fld"><span>Weight now (kg)</span><input type="number" id="s-start" step="0.1" min="35" max="300" inputmode="decimal" value="${p.startKg ?? ""}" required></label>
      <label class="fld"><span>Goal weight (kg)</span><input type="number" id="s-goal" step="0.1" min="35" max="300" inputmode="decimal" value="${p.goalKg ?? ""}" required></label>
    </div>
    <div class="two-col">
      <label class="fld"><span>Height (cm)</span><input type="number" id="s-h" step="1" min="120" max="230" inputmode="numeric" value="${p.heightCm ?? ""}" required></label>
      <label class="fld"><span>Start date</span><input type="date" id="s-date" value="${p.start ?? today()}" required></label>
    </div>
    <div class="hint" id="s-hint">A steady 0.5–1 kg a week is the target. If you have a health condition, check with your GP before starting.</div>
    <div class="actions">
      ${editing ? `<button type="button" class="ghost grow" id="s-reset">Restart…</button>` : ""}
      <button type="button" class="ghost" id="s-cancel">Cancel</button>
      <button type="submit" id="s-ok">${editing ? "Save" : "Start week 1"}</button>
    </div></form>`;
  const check = () => {
    const s = +$("s-start").value, g = +$("s-goal").value, h = +$("s-h").value, hint = $("s-hint");
    hint.classList.remove("bad");
    if (s && g && h) {
      const b = L.bmi(g, h);
      if (g >= s) { hint.textContent = "Your goal should be below your current weight."; hint.classList.add("bad"); return false; }
      if (b < 18.5) { hint.textContent = `That goal is below a healthy weight for your height. The lowest healthy goal is about ${(18.5 * (h / 100) ** 2).toFixed(1)} kg.`; hint.classList.add("bad"); return false; }
      const wk = (s - g) / 0.75;
      hint.textContent = `${(s - g).toFixed(1)} kg to lose — about ${Math.round(wk)} weeks at a steady 0.75 kg a week.${wk > 12 ? " The 12-week programme gets you well on the way; you can run it again." : ""}`;
    }
    return true;
  };
  dlg.querySelectorAll("input").forEach((i) => (i.oninput = check));
  check();
  $("s-cancel").onclick = () => dlg.close();
  if (editing) $("s-reset").onclick = () => {
    if (!confirm("Restart the 12 weeks from today? Your weigh-ins are kept; habit ticks are cleared.")) return;
    for (const d of Object.keys(doc.days)) { doc.days[d].h = []; delete doc.days[d].w; }
    doc.profile.start = today(); doc.profile.startKg = L.trendAt(doc, today()) ?? doc.profile.startKg;
    save(true); dlg.close(); viewDate = today(); started(); showOk("Programme restarted — week 1, day 1.");
  };
  $("f").onsubmit = (e) => {
    if (!check()) { e.preventDefault(); return; }
    const profile = { startKg: +(+$("s-start").value).toFixed(1), goalKg: +(+$("s-goal").value).toFixed(1), heightCm: +$("s-h").value, start: $("s-date").value };
    if (!doc) doc = { v: 1, profile, days: {} }; else doc.profile = profile;
    if (!editing && profile.start <= today()) L.setWeight(doc, profile.start, profile.startKg);
    save(true); viewDate = today(); started();
    showOk(editing ? "Saved." : "You're in. Week 1 starts now — two habits only.");
  };
  dlg.showModal();
}

// ---------- TODAY ----------
function renderToday() {
  const el = $("tab-today");
  const before = daysBetween(doc.profile.start, today()) < 0;
  if (before) {
    el.innerHTML = `<div class="hero"><div class="phase">Starting soon</div><div class="wk">Week 1 starts ${fmtDay(doc.profile.start, { weekday: "long", day: "numeric", month: "long" })}</div>
      <div class="nudge">Read through the Plan tab and make sure your scales and a water bottle are ready.</div></div>`;
    return;
  }
  const d = viewDate, wk = L.weekOf(doc, d), e = L.entry(doc, d), plan = L.PLAN[wk - 1];
  const isToday = d === today(), canBack = daysBetween(doc.profile.start, d) > 0 && daysBetween(d, today()) < 14;
  const score = L.dayScore(doc, d) ?? 0, st = L.streak(doc);
  const habits = L.activeHabits(wk), gymN = L.gymThisWeek(doc, d), fresh = L.newHabitIn(wk);
  const tr = L.trendAt(doc, d), prevTr = L.trendAt(doc, addDays(d, -7));
  const finished = L.finished(doc);

  el.innerHTML = `
    <div class="hero"><div class="row">
      <div><div class="phase">${esc(plan.phase)}${finished ? " · complete" : ""}</div><div class="wk">Week ${wk} · Day ${L.dayOfWeek(doc, d)}</div></div>
      <div class="ring" style="--p:${Math.round(score * 100)}"><span>${Math.round(score * 100)}%</span></div></div>
      <div class="nudge">${isToday ? esc(L.nudge(doc)) : "Catching up on a missed day — that's allowed."} ${st ? `<span style="white-space:nowrap">🔥 ${st}</span>` : ""}</div>
    </div>

    <div class="day-nav">
      <button class="nav" id="prev" ${canBack ? "" : "disabled"} aria-label="Previous day">‹</button>
      <div class="d">${isToday ? "Today" : d === addDays(today(), -1) ? "Yesterday" : fmtDay(d)}<small>${fmtDay(d, { weekday: "long", day: "numeric", month: "long" })}</small></div>
      <button class="nav" id="next" ${isToday ? "disabled" : ""} aria-label="Next day">›</button>
    </div>

    <div class="card">
      <div class="card-h"><h3>Weigh-in</h3><span class="muted small">${tr != null ? `Trend ${L.kg1(tr)}` : ""}</span></div>
      <div class="wt-row"><input id="kg" type="number" step="0.1" min="35" max="300" inputmode="decimal" placeholder="${tr != null ? tr.toFixed(1) : "0.0"}" value="${e.kg ?? ""}"><span class="unit">kg</span></div>
      <div class="wt-meta">${tr != null && prevTr != null ? `${L.signed(tr - prevTr)} on the trend this past week · ` : ""}${L.signed((tr ?? doc.profile.startKg) - doc.profile.startKg)} since you started</div>
    </div>

    <div class="card">
      <div class="card-h"><h3>Habits</h3><span class="muted small">${habits.length} active</span></div>
      ${habits.map((h) => {
        if (h.id === "weigh") return "";
        const on = (e.h || []).includes(h.id);
        const sub = h.perWeek ? `${gymN} of ${h.perWeek} this week` : h.upgraded ? "Levelled up" : esc(h.tip.split(".")[0]);
        const pips = h.perWeek ? `<div class="pips">${Array.from({ length: h.perWeek }, (_, i) => `<i class="${i < gymN ? "on" : ""}"></i>`).join("")}</div>` : "";
        return `<button class="hab ${on ? "on" : ""} ${fresh && fresh.id === h.id ? "new" : ""}" data-h="${h.id}" type="button">
          <span class="ic">${h.icon}</span><span class="nm"><b>${esc(h.name)}</b><small>${sub}</small>${pips}</span><span class="tick">✓</span></button>`;
      }).join("")}
    </div>

    <div class="card focus">
      <div class="ph">This week · ${esc(plan.title)}</div>
      <p style="margin-top:6px">${esc(plan.note)}</p>
      ${fresh && fresh.week > 1 ? `<p style="margin-top:10px"><b style="color:var(--text)">${fresh.icon} Why ${esc(fresh.name.toLowerCase())}:</b> ${esc(fresh.why)}</p>` : ""}
      ${wk >= 5 ? `<button class="link" id="to-wo" type="button" style="margin-top:6px">Open today's workout →</button>` : ""}
    </div>
    <div class="card" id="remind"></div>`;
  renderReminder($("remind"));

  $("prev").onclick = () => { viewDate = addDays(viewDate, -1); renderToday(); };
  $("next").onclick = () => { viewDate = addDays(viewDate, 1); renderToday(); };
  const kg = $("kg");
  kg.onchange = () => {
    const v = parseFloat(kg.value);
    if (kg.value && (isNaN(v) || v < 35 || v > 300)) return showErr("That weight doesn't look right.");
    L.setWeight(doc, d, kg.value ? v : null); save(); renderToday();
  };
  kg.onkeydown = (ev) => { if (ev.key === "Enter") kg.blur(); };
  el.querySelectorAll(".hab").forEach((b) => (b.onclick = () => {
    if (b.dataset.h === "gym" && !(e.h || []).includes("gym")) return pickWorkout(d);
    if (!L.toggleHabit(doc, d, b.dataset.h) && b.dataset.h === "gym") delete doc.days[d].w;
    save(); renderToday();
  }));
  $("to-wo") && ($("to-wo").onclick = () => show("workouts"));
}

// ---------- PROGRESS ----------
function chartSvg() {
  const s = L.trendSeries(doc);
  if (s.length < 2) return `<div class="muted small" style="padding:20px 0;text-align:center">Your chart appears after a few weigh-ins.</div>`;
  const W = 600, H = 220, pl = 34, pr = 10, pt = 10, pb = 22;
  const start = doc.profile.start, end = L.addDays(start, L.WEEKS * 7);
  const lastD = s[s.length - 1].d > end ? s[s.length - 1].d : end;
  const firstD = s[0].d < start ? s[0].d : start;
  const span = Math.max(1, daysBetween(firstD, lastD));
  const vals = s.flatMap((p) => [p.kg, p.t]).concat([doc.profile.goalKg, doc.profile.startKg]);
  let lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  const x = (d) => pl + (daysBetween(firstD, d) / span) * (W - pl - pr);
  const y = (v) => pt + ((hi - v) / (hi - lo)) * (H - pt - pb);
  const step = Math.max(1, Math.round((hi - lo) / 5));
  let grid = "";
  for (let v = Math.ceil(lo); v <= hi; v += step) grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text class="ax" x="${pl - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  for (let w = 0; w <= L.WEEKS; w += 4) { const d = L.addDays(start, w * 7); grid += `<text class="ax" x="${x(d)}" y="${H - 6}" text-anchor="middle">${w === 0 ? "Start" : "Wk " + w}</text>`; }
  const goal = `<line x1="${pl}" x2="${W - pr}" y1="${y(doc.profile.goalKg)}" y2="${y(doc.profile.goalKg)}" stroke="var(--ok)" stroke-dasharray="5 5" stroke-width="1.5"/>`;
  const dots = s.map((p) => `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="2.6" fill="var(--muted)" opacity=".6"/>`).join("");
  const line = `<path d="${s.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.t).toFixed(1)}`).join("")}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const tx = x(today());
  const now = tx >= pl && tx <= W - pr ? `<line x1="${tx}" x2="${tx}" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" stroke-width="1" opacity=".4"/>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight chart">${grid}${goal}${now}${dots}${line}</svg>`;
}

function renderProgress() {
  const p = doc.profile, tr = L.trendAt(doc, today()) ?? p.startKg;
  const lost = p.startKg - tr, togo = tr - p.goalKg, rate = L.ratePerWeek(doc), proj = L.projection(doc);
  const pct = Math.max(0, Math.min(100, (lost / (p.startKg - p.goalKg)) * 100));
  const wkNow = Math.max(1, L.weekOf(doc));

  // habit calendar: one row per programme week
  let heat = `<span></span>${["M", "T", "W", "T", "F", "S", "S"].map((_, i) => `<span class="lb" style="text-align:center">${fmtDay(L.addDays(p.start, i), { weekday: "narrow" })}</span>`).join("")}`;
  for (let w = 1; w <= L.WEEKS; w++) {
    heat += `<span class="lb">Wk ${w}</span>`;
    for (let i = 0; i < 7; i++) {
      const d = L.addDays(p.start, (w - 1) * 7 + i);
      if (daysBetween(d, today()) < 0) { heat += `<span class="c fut"></span>`; continue; }
      const sc = L.dayScore(doc, d) ?? 0;
      heat += `<span class="c ${sc >= 1 ? "s3" : sc >= 0.7 ? "s2" : sc > 0 ? "s1" : ""} ${d === today() ? "today" : ""}" title="${fmtDay(d)} · ${Math.round(sc * 100)}%"></span>`;
    }
  }

  let weeks = "";
  for (let w = wkNow; w >= 1; w--) {
    const s = L.weekSummary(doc, w);
    weeks += `<div class="wrow"><span class="n">Week ${w}</span><span class="bar"><i style="width:${Math.round((s.score ?? 0) * 100)}%"></i></span>
      <span class="c ${s.change != null && s.change < 0 ? "up" : ""}">${s.change != null ? L.signed(s.change) : "–"}</span></div>`;
  }

  $("tab-progress").innerHTML = `
    <div class="hero">
      <div class="phase">Lost so far</div>
      <div class="big">${lost >= 0 ? "" : "+"}${Math.abs(lost).toFixed(1)} kg</div>
      <div class="meter" style="margin:6px 0 2px;height:10px;background:rgba(255,255,255,.14)"><i style="width:${pct}%;background:#fff"></i></div>
      <div class="split">
        <div><div class="k">To goal</div><div class="v">${togo > 0 ? L.kg1(togo) : "Reached 🎉"}</div></div>
        <div><div class="k">${proj ? "On track for" : "Pace"}</div><div class="v">${proj ? fmtDay(proj.date, { day: "numeric", month: "short" }) : rate != null ? L.signed(rate) + "/wk" : "Needs a week"}</div></div>
      </div>
    </div>
    <div class="card chart"><div class="card-h"><h3>Weight</h3><span class="muted small">${rate != null ? `${L.signed(rate)} a week` : ""}</span></div>${chartSvg()}
      <div class="legend"><span><i style="background:var(--accent)"></i>Trend</span><span><i style="background:var(--muted)"></i>Weigh-ins</span><span><i style="background:var(--ok)"></i>Goal ${p.goalKg} kg</span></div></div>
    <div class="card"><div class="stats">
      <div><div class="k">Streak</div><div class="v">🔥 ${L.streak(doc)}</div></div>
      <div><div class="k">Best streak</div><div class="v">${L.bestStreak(doc)} days</div></div>
      <div><div class="k">Workouts</div><div class="v">${Object.values(doc.days).filter((e) => (e.h || []).includes("gym")).length}</div></div>
    </div></div>
    <div class="card"><div class="card-h"><h3>Habit calendar</h3><span class="muted small">70%+ = good day</span></div><div class="heat">${heat}</div></div>
    <div class="card"><div class="card-h"><h3>Week by week</h3><span class="muted small">habits · trend</span></div>${weeks}</div>`;
}

// ---------- WORKOUTS ----------
function renderWorkouts() {
  const wk = Math.max(1, L.weekOf(doc)), rounds = L.roundsFor(wk), n = L.gymThisWeek(doc), target = wk >= 10 ? 4 : 3;
  const s = L.weekStart(doc);
  const doneThisWeek = new Set(); for (let i = 0; i < 7; i++) { const w = doc.days[L.addDays(s, i)]?.w; if (w) doneThisWeek.add(w); }
  const nextUp = ["A", "B", "C"].find((k) => !doneThisWeek.has(k)) || "A";
  $("tab-workouts").innerHTML = `
    ${wk < 5 ? `<div class="note ok">Workouts join the programme in week 5. You can start early if you like.</div>` : ""}
    <div class="card"><div class="card-h"><h3>This week</h3><span class="muted small">${n} of ${target} done</span></div>
      <p class="muted small" style="margin:0">${rounds} rounds of each circuit, ${L.REST_SEC} seconds' rest between moves. About 20 minutes. Warm up first with 2 minutes of marching on the spot and arm circles.</p></div>
    ${Object.entries(L.WORKOUTS).map(([k, w]) => `<button class="wo ${doneThisWeek.has(k) ? "done" : ""}" data-w="${k}" type="button"><span class="L">${doneThisWeek.has(k) ? "✓" : k}</span>
      <span class="nm"><b>${esc(w.name)}${k === nextUp && !doneThisWeek.has(k) ? ` <span class="badge" style="font-size:11px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 22%,transparent);color:var(--accent)">Next</span>` : ""}</b>
      <small>${w.moves.map((m) => m.n).join(" · ")}</small></span><span class="muted">›</span></button>`).join("")}
    <div class="card"><div class="card-h"><h3>No dumbbells to hand?</h3></div><p class="muted small" style="margin:0">Use a full backpack for the goblet squat, rows and deadlifts, or swap the session for a brisk 25-minute walk — it still counts.</p></div>`;
  $("tab-workouts").querySelectorAll(".wo").forEach((b) => (b.onclick = () => workoutSheet(b.dataset.w)));
}

function pickWorkout(date) {
  const dlg = $("dlg");
  dlg.innerHTML = `<h3>Which session?</h3><p class="muted small" style="margin:0 0 10px">Log a home gym session for ${date === today() ? "today" : fmtDay(date)}.</p>
    ${Object.entries(L.WORKOUTS).map(([k, w]) => `<button class="wo" data-w="${k}" type="button" style="box-shadow:none"><span class="L">${k}</span><span class="nm"><b>${esc(w.name)}</b></span></button>`).join("")}
    <button class="wo" data-w="walk" type="button" style="box-shadow:none"><span class="L">🚶</span><span class="nm"><b>Walk or other exercise</b></span></button>
    <div class="actions"><button class="ghost" type="button" id="pw-x">Cancel</button></div>`;
  dlg.querySelectorAll(".wo").forEach((b) => (b.onclick = () => { logWorkout(date, b.dataset.w); dlg.close(); renderToday(); }));
  $("pw-x").onclick = () => dlg.close();
  dlg.showModal();
}
function logWorkout(date, w) {
  const e = (doc.days[date] ||= { h: [] }); e.h ||= [];
  if (!e.h.includes("gym")) e.h.push("gym");
  if (w !== "walk") e.w = w;
  save();
}

function workoutSheet(k) {
  const w = L.WORKOUTS[k], rounds = L.roundsFor(Math.max(1, L.weekOf(doc)));
  const dlg = $("dlg");
  dlg.innerHTML = `<h3>${k} · ${esc(w.name)}</h3><p class="muted small" style="margin:0 0 6px">${rounds} rounds · ${L.REST_SEC}s rest between moves</p>
    ${w.moves.map((m) => `<div class="mv"><b>${esc(m.n)}</b> <span class="muted">${esc(m.r)}</span><small>${esc(m.t)}</small></div>`).join("")}
    <div class="actions"><button class="ghost grow" type="button" id="wo-log">Just log it</button><button class="ghost" type="button" id="wo-x">Close</button><button type="button" id="wo-go">Start</button></div>`;
  $("wo-x").onclick = () => dlg.close();
  $("wo-log").onclick = () => { logWorkout(today(), k); dlg.close(); renderWorkouts(); showOk("Session logged. 💪"); };
  $("wo-go").onclick = () => player(k, rounds);
  if (!dlg.open) dlg.showModal();
}

// Step-by-step player: move → Done → rest timer → next move.
function player(k, rounds) {
  const w = L.WORKOUTS[k], steps = [];
  for (let r = 1; r <= rounds; r++) w.moves.forEach((m) => steps.push({ ...m, rd: r }));
  let i = 0, timer = null, wake = null;
  const dlg = $("dlg");
  try { navigator.wakeLock?.request("screen").then((l) => (wake = l)).catch(() => {}); } catch {}
  const stop = () => { clearInterval(timer); try { wake?.release(); } catch {} };
  dlg.addEventListener("close", stop, { once: true });
  const pbar = () => `<div class="pbar"><i style="width:${(i / steps.length) * 100}%"></i></div>`;

  function move() {
    clearInterval(timer);
    if (i >= steps.length) return finish();
    const s = steps[i];
    const timed = /sec/.test(s.r);
    dlg.innerHTML = `<div class="player"><div class="prog">Round ${s.rd} of ${rounds} · move ${(i % w.moves.length) + 1} of ${w.moves.length}</div>${pbar()}
      <div class="move">${esc(s.n)}</div><div class="reps">${esc(s.r)}</div><div class="how">${esc(s.t)}</div>
      ${timed ? `<div class="clock" id="clk">${parseInt(s.r)}</div>` : ""}
      <div class="acts"><button class="ghost" type="button" id="p-x">End</button><button type="button" id="p-done">${timed ? "Start" : "Done"}</button></div></div>`;
    $("p-x").onclick = () => dlg.close();
    $("p-done").onclick = () => {
      if (timed && !timer) {
        let t = parseInt(s.r); $("p-done").textContent = "Skip";
        timer = setInterval(() => { t--; $("clk") && ($("clk").textContent = t); if (t <= 0) { navigator.vibrate?.(200); i++; rest(); } }, 1000);
        return;
      }
      i++; rest();
    };
  }
  function rest() {
    clearInterval(timer); timer = null;
    if (i >= steps.length) return finish();
    let t = L.REST_SEC; const nx = steps[i];
    dlg.innerHTML = `<div class="player"><div class="prog">Rest</div>${pbar()}<div class="clock" id="clk">${t}</div>
      <div class="next">Next: <b style="color:var(--text)">${esc(nx.n)}</b> · ${esc(nx.r)}</div>
      <div class="acts"><button class="ghost" type="button" id="p-x">End</button><button type="button" id="p-skip">Skip rest</button></div></div>`;
    $("p-x").onclick = () => dlg.close();
    $("p-skip").onclick = () => move();
    timer = setInterval(() => { t--; $("clk") && ($("clk").textContent = t); if (t <= 0) { navigator.vibrate?.(200); move(); } }, 1000);
  }
  function finish() {
    clearInterval(timer); logWorkout(today(), k);
    dlg.innerHTML = `<div class="player"><div class="move">Session done 💪</div><div class="how">${esc(w.name)} logged for today. ${L.gymThisWeek(doc)} this week.</div>
      <div class="acts"><button type="button" id="p-ok">Nice</button></div></div>`;
    $("p-ok").onclick = () => { dlg.close(); show(tab); };
  }
  move();
}

// ---------- PLAN ----------
function renderPlan() {
  const now = L.weekOf(doc);
  $("tab-plan").innerHTML = `<div class="card">
    ${L.PLAN.map((p, idx) => {
      const w = idx + 1, h = L.newHabitIn(w), cls = w < now ? "done" : w === now ? "now" : "";
      const ups = L.HABITS.filter((x) => x.upgrade && x.upgrade.week === w).map((x) => L.habitView(x, w));
      const sc = w < now ? L.weekSummary(doc, w).score : null;
      return `<div class="plan-wk ${cls}"><div class="t">Week ${w} · ${esc(p.phase)} · ${fmtDay(L.addDays(doc.profile.start, idx * 7), { day: "numeric", month: "short" })}${sc != null ? ` · ${Math.round(sc * 100)}% habits` : ""}</div>
        <h4>${esc(p.title)}</h4><p>${esc(p.note)}</p>
        ${h ? `<div class="add">＋ <b>${h.icon} ${esc(h.name)}</b>${h.perWeek ? ` · ${h.perWeek}× a week` : ""}</div>` : ""}
        ${ups.map((u) => `<div class="add">⬆︎ <b>${u.icon} ${esc(u.perWeek ? `${u.name} · ${u.perWeek}× a week` : u.name)}</b></div>`).join("")}</div>`;
    }).join("")}</div>
    <div class="card"><div class="card-h"><h3>The rules</h3></div><p class="muted small" style="margin:0">
      Missed a day? Fill it in from the Today tab — you can go back two weeks. A day counts as good at 70% of its habits.
      Aim for 0.5–1 kg a week on the trend line; ignore single weigh-ins, they jump around with water and salt.</p></div>`;
}

// ---------- 9:30pm reminder (Web Push) ----------
const PUSH = "/api/lean/push";
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function currentSub() {
  if (!pushable) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function renderReminder(el) {
  if (!el) return;
  const head = `<div class="card-h"><h3>🔔 End-of-day reminder</h3><span class="muted small">9:30pm</span></div>`;
  if (!pushable) {
    el.innerHTML = head + (isIOS && !standalone
      ? `<p class="muted small" style="margin:0">iPhones only allow notifications from Home Screen apps. In Safari tap <b>Share → Add to Home Screen</b>, open <b>Dashboard</b> from your Home Screen, sign in, then come back here and turn this on.</p>`
      : `<p class="muted small" style="margin:0">This browser can't show notifications.</p>`);
    return;
  }
  if (Notification.permission === "denied") {
    el.innerHTML = head + `<p class="muted small" style="margin:0">Notifications are blocked. Turn them on in your iPhone's <b>Settings → Notifications → Dashboard</b>, then reopen this page.</p>`;
    return;
  }
  let sub = null, st = null;
  try { sub = await currentSub(); st = await api(PUSH + (sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "")); }
  catch (e) { el.innerHTML = head + `<p class="muted small" style="margin:0">${esc(e.message)}</p>`; return; }
  if (sub && st.on) {
    el.innerHTML = head + `<p class="muted small" style="margin:0">On for this device. Around 9:30pm (${esc(st.tz.replace(/_/g, " "))} time) you'll get a nudge — only if today isn't filled in yet.</p>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="ghost" id="r-test" type="button">Send a test</button><button class="ghost" id="r-off" type="button">Turn off</button></div>`;
    $("r-test").onclick = async () => {
      try { const r = await api(PUSH, { method: "POST", body: JSON.stringify({ test: true, tz: tz() }) }); showOk(r.sent ? "Test sent — it should pop up in a few seconds." : "Couldn't reach your phone — try turning reminders off and on again."); }
      catch (e) { showErr(e.message); }
    };
    $("r-off").onclick = async () => {
      try { await api(PUSH, { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); showOk("Reminders turned off."); }
      catch (e) { showErr(e.message); }
      renderReminder(el);
    };
    return;
  }
  el.innerHTML = head + `<p class="muted small" style="margin:0">Get a notification at 9:30pm if you haven't checked in yet. Skipped on days you've already done everything.</p>
    <button id="r-on" type="button" style="margin-top:10px">Turn on reminders</button>`;
  $("r-on").onclick = async () => {
    try {
      const perm = await Notification.requestPermission();   // must come first, straight from the tap
      if (perm !== "granted") { renderReminder(el); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const s = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(st.publicKey) }));
      await api(PUSH, { method: "POST", body: JSON.stringify({ subscription: s.toJSON(), tz: tz() }) });
      showOk("Reminders on — see you at 9:30pm.");
    } catch (e) { showErr("Couldn't turn on reminders: " + e.message); }
    renderReminder(el);
  };
}

// Keep the reminder in step with where you are (UK or Dubai) whenever you open the page.
async function syncTz() {
  try { if (Notification.permission === "granted" && (await currentSub())) await api(PUSH, { method: "POST", body: JSON.stringify({ tz: tz() }) }); } catch {}
}

// ---------- start ----------
(async () => {
  try {
    doc = (await api(L.STORE)).data;
  } catch (e) { $("loading").hidden = true; return showErr(e.message); }
  $("loading").hidden = true;
  const qs = new URLSearchParams(location.search);
  if (qs.get("tab")) tab = qs.get("tab");
  if (doc?.profile) started(); else renderWelcome();
  if (pushable) syncTz();
})();
// Coming back to the page on a new day: jump to today.
let lastDay = today();
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !doc?.profile || lastDay === today()) return;
  if (viewDate === lastDay) viewDate = today();
  lastDay = today(); show(tab);
});

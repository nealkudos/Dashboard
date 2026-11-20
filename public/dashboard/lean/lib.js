// Lean 12 — shared programme logic for the /dashboard/lean/ page and the dashboard block.
// All data lives in one JSON document in block storage (/api/blocks/lean).
//
// doc = {
//   v: 1,
//   profile: { start: "YYYY-MM-DD", startKg, goalKg, heightCm },
//   days: { "YYYY-MM-DD": { kg?: number, h: [habitIds], w?: "A"|"B"|"C" } }
// }

export const STORE = "/api/blocks/lean";
export const WEEKS = 12;

// ---------- the habits ----------
// One new habit a week for the first eight weeks; weeks 9–12 raise the bar on two of them.
export const HABITS = [
  { id: "weigh", icon: "⚖️", name: "Weigh in", week: 1,
    why: "Daily weigh-ins are noisy, but the 7-day trend isn't — and it's what keeps you honest.",
    tip: "Same time each morning, after the loo, before food. Enter it whenever you check in." },
  { id: "water", icon: "💧", name: "2 litres of water", week: 1,
    why: "Thirst is easily mistaken for hunger, especially in long show days.",
    tip: "Keep a 1L bottle in the car or bag and finish it twice." },
  { id: "protein", icon: "🍗", name: "Protein at every meal", week: 2,
    why: "Protein keeps you full the longest and protects muscle while you lose fat.",
    tip: "Lidl protein meals, eggs, Greek yoghurt, chicken, tuna, lentils — a palm-sized portion each meal." },
  { id: "steps", icon: "👟", name: "8,000 steps", week: 3, upgrade: { week: 9, name: "10,000 steps" },
    why: "Walking burns more over a week than most gym sessions, and costs no recovery.",
    tip: "Your iPhone counts them. Park further away and walk calls." },
  { id: "kitchen", icon: "🌙", name: "Kitchen closed after dinner", week: 4,
    why: "Late snacking is where most surplus calories hide.",
    tip: "Dinner is the last food of the day. Brush your teeth straight after — it works." },
  { id: "gym", icon: "🏋️", name: "Home gym", week: 5, perWeek: 3, upgrade: { week: 10, perWeek: 4 },
    why: "Strength work keeps the weight you lose coming off fat, not muscle.",
    tip: "20 minutes is enough. Do it before dinner or while dinner's in the oven." },
  { id: "drinks", icon: "🥤", name: "Zero-sugar drinks only", week: 6,
    why: "Liquid calories don't fill you up — cutting them is the easiest win there is.",
    tip: "Water, black coffee, tea, diet drinks. Save alcohol for one planned night." },
  { id: "veg", icon: "🥦", name: "Half a plate of veg", week: 7,
    why: "Volume without calories — a bigger plate for less.",
    tip: "Frozen veg and salad bags count. Fill half the plate first, then add the rest." },
  { id: "sleep", icon: "😴", name: "In bed by 11", week: 8,
    why: "Short sleep raises hunger hormones the next day — you'll eat more without noticing.",
    tip: "Phone on charge outside the bedroom at 10:45." },
];
export const HABIT = Object.fromEntries(HABITS.map((h) => [h.id, h]));

// Weekly focus notes — one fresh thing to read and do each week.
export const PLAN = [
  { phase: "Foundations", title: "Start the trend", note: "Two habits only. Weigh in every morning and drink your water. Don't change what you eat yet — this week is about the routine, and about learning your real starting point." },
  { phase: "Foundations", title: "Protein first", note: "Build each meal around a protein. You'll notice you're less hungry by mid-afternoon. A Lidl protein meal for lunch is a perfect fit." },
  { phase: "Foundations", title: "Walk more", note: "8,000 steps a day. On site days you'll beat it easily; on office days, walk the first and last 10 minutes of the commute or take calls on foot." },
  { phase: "Foundations", title: "Close the kitchen", note: "Dinner around 8 is your last food. If you're hungry later, have water or tea. By the end of this week the first 2–3 kg should be showing on the trend." },
  { phase: "Build", title: "Pick up the weights", note: "Three 20-minute home gym sessions this week — A, B and C in the Workouts tab. Start light; the goal is turning up, not wrecking yourself." },
  { phase: "Build", title: "Drink zero", note: "Swap sugary drinks for zero-sugar ones. If you drink alcohol, plan one night for it rather than letting it drift into the week." },
  { phase: "Build", title: "Bigger plates, fewer calories", note: "Half a plate of veg at dinner. It's the easiest way to eat less without feeling like you're on a diet." },
  { phase: "Build", title: "Sleep on it", note: "In bed by 11. Tired days are hungry days — this one quietly makes everything else easier." },
  { phase: "Push", title: "Step it up", note: "Steps go to 10,000. Every habit is now unlocked — this phase is about stringing good weeks together." },
  { phase: "Push", title: "Four sessions", note: "Home gym goes to four times a week, and the circuits go to four rounds. If a session gets missed, do a 20-minute walk instead." },
  { phase: "Push", title: "Plan the hard days", note: "Look at your calendar for the week: event days, late finishes, travel. Decide now what you'll eat on those days so they don't decide for you." },
  { phase: "Push", title: "Make it yours", note: "Last week of the programme. Look at the Progress tab: which habits held, which didn't? Keep the ones that stuck — you can restart the 12 weeks any time with a new goal." },
];

// ---------- workouts ----------
// 20-minute circuits for a small home gym: a pair of dumbbells and a bit of floor.
export const WORKOUTS = {
  A: { name: "Legs & push", moves: [
    { n: "Goblet squat", r: "12 reps", t: "Hold one dumbbell at your chest, sit back and down." },
    { n: "Push-ups", r: "10 reps", t: "On your knees is fine. Chest to the floor." },
    { n: "Romanian deadlift", r: "12 reps", t: "Soft knees, push hips back, flat back." },
    { n: "Plank", r: "30 sec", t: "Squeeze your glutes, don't let the hips drop." },
  ] },
  B: { name: "Pull & lunge", moves: [
    { n: "One-arm row", r: "10 each side", t: "Hand on a bench or chair, pull the dumbbell to your hip." },
    { n: "Reverse lunge", r: "10 each side", t: "Step back, back knee just above the floor." },
    { n: "Shoulder press", r: "10 reps", t: "Standing, press both dumbbells overhead." },
    { n: "Glute bridge", r: "15 reps", t: "On your back, drive through your heels, pause at the top." },
  ] },
  C: { name: "Conditioning", moves: [
    { n: "Squat to press", r: "12 reps", t: "Squat with dumbbells at your shoulders, press as you stand." },
    { n: "Mountain climbers", r: "30 sec", t: "Hands under shoulders, drive the knees in fast." },
    { n: "Step-ups", r: "10 each side", t: "On a sturdy step or low bench." },
    { n: "Dead bug", r: "10 each side", t: "On your back, lower opposite arm and leg slowly." },
  ] },
};
export const roundsFor = (week) => (week >= 10 ? 4 : 3);
export const REST_SEC = 45;

// ---------- dates ----------
export const today = () => new Date().toLocaleDateString("en-CA");
export const addDays = (d, n) => { const t = new Date(d + "T12:00:00"); t.setDate(t.getDate() + n); return t.toLocaleDateString("en-CA"); };
export const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000);
export const fmtDay = (d, o = { weekday: "short", day: "numeric", month: "short" }) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", o);

// ---------- programme position ----------
export function weekOf(doc, date = today()) {
  const d = daysBetween(doc.profile.start, date);
  if (d < 0) return 0;
  return Math.min(WEEKS, Math.floor(d / 7) + 1);
}
export const dayOfWeek = (doc, date = today()) => (((daysBetween(doc.profile.start, date) % 7) + 7) % 7) + 1;
export const finished = (doc, date = today()) => daysBetween(doc.profile.start, date) >= WEEKS * 7;

export function habitView(h, week) {
  const up = h.upgrade && week >= h.upgrade.week ? h.upgrade : {};
  return { ...h, ...up, upgraded: !!up.week };
}
export const activeHabits = (week) => HABITS.filter((h) => h.week <= Math.max(1, week)).map((h) => habitView(h, week));
export const dailyHabits = (week) => activeHabits(week).filter((h) => !h.perWeek);
export const newHabitIn = (week) => HABITS.find((h) => h.week === week) || null;

// Monday-style week starting on the programme start day.
export function weekStart(doc, date = today()) {
  const d = daysBetween(doc.profile.start, date);
  return addDays(doc.profile.start, Math.floor(d / 7) * 7);
}
export function gymThisWeek(doc, date = today()) {
  const s = weekStart(doc, date); let n = 0;
  for (let i = 0; i < 7; i++) { const e = doc.days[addDays(s, i)]; if (e && (e.h || []).includes("gym")) n++; }
  return n;
}

export function entry(doc, date) { return doc.days[date] || { h: [] }; }

// Share of the day's daily habits done (weigh-in counts when a weight is entered).
export function dayScore(doc, date) {
  const wk = weekOf(doc, date); if (!wk) return null;
  const e = doc.days[date]; if (!e) return 0;
  const list = dailyHabits(wk);
  const done = list.filter((h) => (h.id === "weigh" ? e.kg != null : (e.h || []).includes(h.id))).length;
  return done / list.length;
}
export const goodDay = (doc, date) => (dayScore(doc, date) ?? 0) >= 0.7;

// Consecutive good days, ending today (today only counts once it's good — it can't break the streak).
export function streak(doc, date = today()) {
  let n = 0, d = goodDay(doc, date) ? date : addDays(date, -1);
  while (daysBetween(doc.profile.start, d) >= 0 && goodDay(doc, d)) { n++; d = addDays(d, -1); }
  return n;
}
export function bestStreak(doc) {
  let best = 0, run = 0;
  const end = today();
  for (let d = doc.profile.start; daysBetween(d, end) >= 0; d = addDays(d, 1)) { run = goodDay(doc, d) ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

export function weekSummary(doc, week) {
  const s = addDays(doc.profile.start, (week - 1) * 7);
  let sum = 0, n = 0, gym = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(s, i); if (daysBetween(d, today()) < 0) break;
    sum += dayScore(doc, d) ?? 0; n++;
    if ((doc.days[d]?.h || []).includes("gym")) gym++;
  }
  const t0 = trendAt(doc, addDays(s, -1)) ?? doc.profile.startKg;
  const t1 = trendAt(doc, addDays(s, Math.min(6, Math.max(0, n - 1))));
  return { start: s, days: n, score: n ? sum / n : null, gym, change: t1 != null && n ? t1 - t0 : null };
}

// ---------- weight trend ----------
// Exponentially smoothed weight (10% of each new reading), the same idea as "The Hacker's Diet".
export function trendSeries(doc) {
  const pts = Object.entries(doc.days).filter(([, e]) => e.kg != null).sort(([a], [b]) => a.localeCompare(b));
  const out = []; let t = null, prev = null;
  for (const [d, e] of pts) {
    if (t == null) t = e.kg;
    else {
      const gap = Math.max(1, daysBetween(prev, d));
      const a = 1 - Math.pow(0.9, gap);   // missed days catch up proportionally
      t = t + a * (e.kg - t);
    }
    out.push({ d, kg: e.kg, t }); prev = d;
  }
  return out;
}
export function trendAt(doc, date) {
  const s = trendSeries(doc).filter((p) => p.d <= date);
  return s.length ? s[s.length - 1].t : null;
}
// kg per week, from the trend over the last 14 days (needs a week of data).
export function ratePerWeek(doc) {
  const s = trendSeries(doc); if (s.length < 5) return null;
  const last = s[s.length - 1];
  const older = s.filter((p) => daysBetween(p.d, last.d) >= 14);
  const past = older.length ? older[older.length - 1] : s[0];
  const span = daysBetween(past.d, last.d); if (span < 7) return null;
  return ((last.t - past.t) / span) * 7;
}
export function projection(doc) {
  const s = trendSeries(doc), r = ratePerWeek(doc);
  if (!s.length || r == null || r >= -0.05) return null;
  const now = s[s.length - 1].t, togo = now - doc.profile.goalKg;
  if (togo <= 0) return { date: today(), weeks: 0 };
  const weeks = togo / -r;
  if (weeks > 104) return null;
  return { date: addDays(s[s.length - 1].d, Math.round(weeks * 7)), weeks };
}

export const bmi = (kg, cm) => (cm ? kg / Math.pow(cm / 100, 2) : null);
export const kg1 = (n) => (n == null ? "–" : `${n.toFixed(1)} kg`);
export const signed = (n) => (n == null ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)} kg`);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- toggling ----------
export function toggleHabit(doc, date, id) {
  const e = (doc.days[date] ||= { h: [] });
  e.h ||= [];
  e.h = e.h.includes(id) ? e.h.filter((x) => x !== id) : [...e.h, id];
  return e.h.includes(id);
}
export function setWeight(doc, date, kg) {
  const e = (doc.days[date] ||= { h: [] });
  if (kg == null || isNaN(kg)) delete e.kg; else e.kg = Math.round(kg * 10) / 10;
}

// Encouraging one-liner for the top of the page.
export function nudge(doc, date = today()) {
  const sc = dayScore(doc, date) ?? 0, st = streak(doc, date), r = ratePerWeek(doc);
  if (r != null && r < -1.2) return "You're losing faster than 1 kg a week — eat a little more. Slower loss sticks.";
  if (sc >= 1) return st > 1 ? `Perfect day — ${st} good days in a row.` : "Perfect day. Do it again tomorrow.";
  if (sc >= 0.7) return "Good day banked. That's what counts.";
  if (st >= 3) return `${st}-day streak on the line — a couple of ticks keeps it going.`;
  const h = new Date().getHours();
  return h < 12 ? "Morning — start with the weigh-in." : "Takes 20 seconds: tick off what you've done today.";
}

// Lean 12 end-of-day reminder: who to notify, when, and what to say.
import { kv } from "./core.js";
import { sendPush } from "./webpush.js";
import * as L from "../../public/dashboard/lean/lib.js";

export const PUSH_KEY = "lean:push";
export const DEFAULT_TIME = "21:30";

export async function getCfg(env) {
  return (await kv(env).get(PUSH_KEY, "json")) || { time: DEFAULT_TIME, tz: "Europe/London", subs: [], lastSent: null };
}
export const putCfg = (env, cfg) => kv(env).put(PUSH_KEY, JSON.stringify(cfg));

// Date and time on the wall clock where Neal is (the phone reports its time zone when he opens Lean 12).
export function localNow(tz) {
  let parts;
  try { parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); }
  catch { return localNow("Europe/London"); }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

// What the notification should say for that day — or null if there's nothing left to do.
export function reminderFor(doc, date) {
  if (!doc?.profile) return null;
  if (L.daysBetween(doc.profile.start, date) < 0 || L.finished(doc, date)) return null;
  const wk = L.weekOf(doc, date), e = doc.days?.[date] || { h: [] };
  const daily = L.dailyHabits(wk);
  const left = daily.filter((h) => (h.id === "weigh" ? e.kg == null : !(e.h || []).includes(h.id)));
  if (!left.length) return null;
  const streak = L.streak(doc, L.addDays(date, -1));
  const weigh = left.some((h) => h.id === "weigh");
  const habits = left.filter((h) => h.id !== "weigh").length;
  let body;
  if (left.length === daily.length) body = `Nothing ticked yet today — weigh-in and ${habits} habit${habits === 1 ? "" : "s"}. Takes 20 seconds.`;
  else body = `${weigh ? "Weigh-in" + (habits ? " and " : "") : ""}${habits ? `${habits} habit${habits === 1 ? "" : "s"}` : ""} still to tick.`;
  if (streak >= 2) body += ` 🔥 ${streak}-day streak on the line.`;
  return { title: `Lean 12 · Week ${wk} check-in`, body, url: "/dashboard/lean/", tag: "lean-daily" };
}

export async function sendAll(env, cfg, message) {
  let sent = 0;
  const keep = [];
  for (const sub of cfg.subs) {
    try {
      const r = await sendPush(env, sub, message);
      if (r.ok) sent++;
      if (!r.gone) keep.push(sub);
    } catch { keep.push(sub); }
  }
  cfg.subs = keep;
  return sent;
}

// Calendar feeds: fetch private iCal (.ics) links, expand repeating events, return one merged list.
import ICAL from "./ical.js";
import { kv } from "./core.js";
import { sha256Hex } from "./crypto.js";

export const HOME_TZ = "Europe/London";
const CACHE_SECONDS = 600; // re-fetch each feed at most every 10 minutes
const MAX_OCCURRENCES = 5000;

// Outlook/Exchange feeds often use Windows zone names.
const WINDOWS_TZ = {
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Etc/GMT",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "E. Europe Standard Time": "Europe/Bucharest",
  "GTB Standard Time": "Europe/Athens",
  "Turkey Standard Time": "Europe/Istanbul",
  "Arabian Standard Time": "Asia/Dubai",
  "India Standard Time": "Asia/Kolkata",
  "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "UTC": "UTC",
};

// ---------- Sources (stored server-side in KV) ----------
export async function getSources(env) {
  return (await kv(env).get("calendars", "json")) || [];
}
export async function putSources(env, list) {
  await kv(env).put("calendars", JSON.stringify(list));
}

export function normaliseUrl(raw) {
  let url = String(raw || "").trim();
  if (/^webcals?:\/\//i.test(url)) url = url.replace(/^webcals?:\/\//i, "https://");
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  return u.toString();
}

export function maskUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}/…${u.pathname.slice(-6)}`;
  } catch { return "link saved"; }
}

// ---------- Time helpers ----------
function tzOffsetMs(zone, utcMs) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function wallToUtc(t, zone) {
  const guess = Date.UTC(t.year, t.month - 1, t.day, t.hour || 0, t.minute || 0, t.second || 0);
  let ms = guess - tzOffsetMs(zone, guess);
  ms = guess - tzOffsetMs(zone, ms); // second pass handles DST edges
  return ms;
}

function ianaFor(tzid) {
  if (!tzid) return HOME_TZ;
  if (WINDOWS_TZ[tzid]) return WINDOWS_TZ[tzid];
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tzid }); return tzid; } catch { return HOME_TZ; }
}

function isRealZone(t) {
  const z = t.zone;
  return z && z !== ICAL.Timezone.localTimezone && z.tzid !== "floating" &&
    (z === ICAL.Timezone.utcTimezone || z.tzid === "UTC" || !!z.component);
}

function toMs(t) {
  if (isRealZone(t)) return t.toJSDate().getTime();
  return wallToUtc(t, ianaFor(t.timezone || (t.zone && t.zone.tzid)));
}

const pad = (n) => String(n).padStart(2, "0");
const dateStr = (t) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;
const midnight = (t) => wallToUtc({ year: t.year, month: t.month, day: t.day, hour: 0, minute: 0, second: 0 }, HOME_TZ);

export function londonDayStartMs(now = Date.now()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: HOME_TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(now)).map((x) => [x.type, x.value])
  );
  return wallToUtc({ year: +p.year, month: +p.month, day: +p.day, hour: 0, minute: 0, second: 0 }, HOME_TZ);
}

// ---------- Fetch + parse ----------
async function fetchIcs(url) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`https://calendar-cache.internal/${await sha256Hex(url)}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit.text();
  }
  let res;
  try {
    res = await fetch(url, {
    headers: { "user-agent": "NealDashboard/1.0 (+calendar)", accept: "text/calendar, */*" },
    redirect: "follow",
      cf: { cacheTtl: 0 },
    });
  } catch {
    throw new Error("couldn't reach that calendar link — check it's copied in full");
  }
  if (res.status === 401 || res.status === 403) throw new Error("the link was refused — it may not be published/shared, or it was reset");
  if (res.status === 404) throw new Error("that link no longer exists — it may have been reset; add the new one");
  if (!res.ok) throw new Error(`the calendar link returned ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("that link isn't a calendar (.ics) feed");
  if (cache) {
    await cache.put(key, new Response(text, { headers: { "cache-control": `max-age=${CACHE_SECONDS}` } }));
  }
  return text;
}

export function eventsFromIcs(text, winStart, winEnd) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try {
      const tzid = tz.getFirstPropertyValue("tzid");
      if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(tz);
    } catch {}
  }

  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map();
  const exceptions = [];
  for (const ve of vevents) {
    if (ve.hasProperty("recurrence-id")) exceptions.push(ve);
    else masters.set(ve.getFirstPropertyValue("uid") || Math.random().toString(), new ICAL.Event(ve));
  }
  for (const ex of exceptions) {
    const m = masters.get(ex.getFirstPropertyValue("uid"));
    if (m) { try { m.relateException(ex); } catch {} }
    else masters.set(Math.random().toString(), new ICAL.Event(ex));
  }

  const out = [];
  const push = (ev, start, end) => {
    if ((ev.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") return;
    const allDay = start.isDate;
    let s, e, endDay = null;
    if (allDay) {
      let endT = end && end.compare(start) > 0 ? end : null;
      if (!endT) { endT = start.clone(); endT.adjust(1, 0, 0, 0); }
      endDay = endT;
      s = midnight(start);
      e = midnight(endT);
    } else {
      s = toMs(start);
      e = end ? toMs(end) : s;
    }
    if (e <= winStart || s >= winEnd) return;
    out.push({
      title: ev.summary || "(No title)",
      location: ev.location || "",
      allDay,
      start: allDay ? dateStr(start) : new Date(s).toISOString(),
      end: allDay ? dateStr(endDay) : new Date(e).toISOString(),
      startMs: s,
    });
  };

  for (const ev of masters.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) { push(ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    let next, n = 0;
    while ((next = it.next()) && n++ < MAX_OCCURRENCES) {
      const nextMs = next.isDate ? midnight(next) : toMs(next);
      if (nextMs >= winEnd) break;
      // cheap skip of occurrences well before the window
      if (nextMs < winStart - 40 * 86400000) continue;
      const d = ev.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate);
    }
  }
  return out;
}

export async function loadEvents(env, days) {
  const sources = await getSources(env);
  const winStart = londonDayStartMs();
  const winEnd = winStart + days * 86400000;
  const events = [];
  const errors = [];
  await Promise.all(sources.map(async (src) => {
    try {
      const text = await fetchIcs(src.url);
      for (const e of eventsFromIcs(text, winStart, winEnd)) events.push({ ...e, cal: src.id });
    } catch (err) {
      errors.push({ cal: src.id, name: src.name, error: err.message || "couldn't load" });
    }
  }));
  events.sort((a, b) => a.startMs - b.startMs || (b.allDay - a.allDay));
  return {
    calendars: sources.map(({ id, name, color }) => ({ id, name, color })),
    events: events.map(({ startMs, ...e }) => e),
    errors,
    from: new Date(winStart).toISOString(),
    days,
  };
}

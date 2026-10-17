// GET /api/calendar?days=14 — merged upcoming events from all saved calendar links. Signed-in only.
import { json, fail } from "../../_lib/core.js";
import { loadEvents } from "../../_lib/calendar.js";

export async function onRequestGet({ request, env }) {
  const days = Math.min(60, Math.max(1, parseInt(new URL(request.url).searchParams.get("days") || "14", 10) || 14));
  try {
    return json({ ok: true, ...(await loadEvents(env, days)) });
  } catch (e) {
    return fail(e.message || "Couldn't load calendars", 500);
  }
}

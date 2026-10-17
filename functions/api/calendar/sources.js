// /api/calendar/sources — the calendar links (kept on the server; the full link is never sent back).
import { json, fail, readJson, sameOrigin } from "../../_lib/core.js";
import { getSources, putSources, normaliseUrl, maskUrl } from "../../_lib/calendar.js";
import { randomId } from "../../_lib/crypto.js";

const COLOR = /^#[0-9a-f]{6}$/i;

export async function onRequestGet({ env }) {
  const list = await getSources(env);
  return json({ ok: true, sources: list.map(({ id, name, color, url }) => ({ id, name, color, hint: maskUrl(url) })) });
}

// PUT { sources: [{ id?, name, color, url? }] } — url only needed for new ones or to replace a link.
export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request)) return fail("Bad origin", 403);
  const body = await readJson(request);
  const incoming = Array.isArray(body.sources) ? body.sources : null;
  if (!incoming) return fail("Missing sources");
  if (incoming.length > 12) return fail("12 calendars max");

  const existing = new Map((await getSources(env)).map((s) => [s.id, s]));
  const next = [];
  for (const s of incoming) {
    const name = String(s.name || "").trim().slice(0, 40) || "Calendar";
    const color = COLOR.test(s.color || "") ? s.color : "#2f6f5e";
    let url = null;
    if (s.url) {
      url = normaliseUrl(s.url);
      if (!url) return fail(`"${name}": that doesn't look like a calendar link (it should start with webcal:// or https://).`);
    } else if (s.id && existing.has(s.id)) {
      url = existing.get(s.id).url;
    } else {
      return fail(`"${name}" needs a calendar link.`);
    }
    next.push({ id: s.id && existing.has(s.id) ? s.id : randomId(6), name, color, url });
  }
  await putSources(env, next);
  return json({ ok: true });
}

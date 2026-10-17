// /api/prefs — dashboard layout (block order, sizes, hidden). Signed-in only (see _middleware.js).
import { json, fail, readJson, sameOrigin, kv } from "../_lib/core.js";

export async function onRequestGet({ env }) {
  const prefs = (await kv(env).get("prefs", "json")) || {};
  return json({ ok: true, prefs });
}

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request)) return fail("Bad origin", 403);
  const body = await readJson(request);
  const raw = JSON.stringify(body.prefs ?? {});
  if (raw.length > 20000) return fail("Too large", 413);
  await kv(env).put("prefs", raw);
  return json({ ok: true });
}

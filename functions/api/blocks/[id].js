// /api/blocks/:id — small private data store each block can use (notes, links, settings…).
import { json, fail, readJson, sameOrigin, kv, blockKey } from "../../_lib/core.js";

export async function onRequestGet({ env, params }) {
  const key = blockKey(params.id);
  if (!key) return fail("Bad block id");
  return json({ ok: true, data: (await kv(env).get(key, "json")) ?? null });
}

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return fail("Bad origin", 403);
  const key = blockKey(params.id);
  if (!key) return fail("Bad block id");
  const body = await readJson(request);
  const raw = JSON.stringify(body.data ?? null);
  if (raw.length > 100000) return fail("Too large (100 KB max per block)", 413);
  await kv(env).put(key, raw);
  return json({ ok: true });
}

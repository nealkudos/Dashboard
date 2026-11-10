// POST /api/shortcut/screenshot — the iPhone Shortcut sends one banking-app screenshot here (raw image body),
// with "Authorization: Bearer <key>" (key made in Budget → ⚙︎ → iPhone Shortcut). The Shortcut then deletes the photo.
// Screenshots wait here (for up to 2 days) until the budget page reads them on your phone; then they're deleted.
import { json, fail, kv, isLocked, noteFailure } from "../../_lib/core.js";
import { sha256Hex, timingSafeEqual, randomId } from "../../_lib/crypto.js";

const MAX = 12 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  if (await isLocked(env, request)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const stored = await kv(env).get("shortcut:key");
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!stored || !given || !timingSafeEqual(await sha256Hex(given), stored)) {
    await noteFailure(env, request);
    return fail("Wrong or missing Shortcut key — make a new one in Budget → ⚙︎ → iPhone Shortcut.", 401);
  }
  const type = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^image\//.test(type) && type !== "application/octet-stream") return fail("Send the screenshot as the request body (Request Body: File).", 415);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return fail("No image received.", 400);
  if (buf.byteLength > MAX) return fail("That image is too big.", 413);
  const waiting = await kv(env).list({ prefix: "shot:" });
  if (waiting.keys.length >= 40) return fail("40 screenshots are already waiting — open the Budget page to read them first.", 429);
  const id = `${Date.now()}-${randomId(4)}`;
  await kv(env).put(`shot:${id}`, buf, { expirationTtl: 2 * 86400, metadata: { type: /^image\//.test(type) ? type : "image/jpeg", size: buf.byteLength } });
  return json({ ok: true, id, waiting: waiting.keys.length + 1, message: "Sent to your budget" });
}

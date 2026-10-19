// /api/trading-stream — live gold price + open trades pushed from the bot as they change (signed-in only).
// Passes the bot's Server-Sent Events straight through; the browser reconnects on its own.
export async function onRequestGet({ env, request }) {
  let base = String(env.COPIER_URL || "").trim().replace(/\/+$/, "");
  if (base && !/^[a-z]+:\/\//i.test(base)) base = "https://" + base;
  if (!base || !env.COPIER_PASSWORD) return new Response("not connected", { status: 503 });
  if (!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) {
    return new Response("bad COPIER_URL", { status: 500 });
  }
  let up;
  try {
    up = await fetch(base + "/api/stream", {
      headers: { authorization: "Basic " + btoa("dashboard:" + env.COPIER_PASSWORD), accept: "text/event-stream" },
      signal: request.signal,
    });
  } catch {
    return new Response("bot unreachable", { status: 502 });
  }
  if (!up.ok || !up.body) return new Response("bot error", { status: 502 });
  return new Response(up.body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

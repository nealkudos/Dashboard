// /api/lean/push — turn the Lean 12 end-of-day reminder on/off for this device, or send a test. Signed-in only.
//   GET                          → { publicKey, on, time, tz, devices }
//   POST { subscription, tz }    → subscribe this device (also refreshes the time zone)
//   POST { tz }                  → just refresh the time zone
//   POST { test: true }          → send a test notification to every device now
//   DELETE { endpoint }          → unsubscribe this device
import { json, fail, readJson, sameOrigin } from "../../_lib/core.js";
import { vapidKeys } from "../../_lib/webpush.js";
import { getCfg, putCfg, sendAll } from "../../_lib/lean.js";

const validTz = (tz) => { try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; } };

export async function onRequestGet({ env, request }) {
  const cfg = await getCfg(env), { publicRaw } = await vapidKeys(env);
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  return json({ ok: true, publicKey: publicRaw, on: endpoint ? cfg.subs.some((s) => s.endpoint === endpoint) : cfg.subs.length > 0, time: cfg.time, tz: cfg.tz, devices: cfg.subs.length });
}

export async function onRequestPost({ env, request }) {
  if (!sameOrigin(request)) return fail("Bad origin", 403);
  const body = await readJson(request), cfg = await getCfg(env);
  if (body.tz && validTz(body.tz)) cfg.tz = body.tz;

  if (body.subscription) {
    const s = body.subscription;
    if (!/^https:\/\//.test(s.endpoint || "") || !s.keys?.p256dh || !s.keys?.auth) return fail("Bad subscription");
    cfg.subs = cfg.subs.filter((x) => x.endpoint !== s.endpoint);
    cfg.subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, added: new Date().toISOString() });
    cfg.subs = cfg.subs.slice(-5);
  }

  let sent = null;
  if (body.test) {
    if (!cfg.subs.length) return fail("Reminders aren't turned on for any device yet");
    sent = await sendAll(env, cfg, { title: "Lean 12", body: "Test reminder — notifications are working. 👍", url: "/dashboard/lean/", tag: "lean-test" });
  }
  await putCfg(env, cfg);
  return json({ ok: true, devices: cfg.subs.length, tz: cfg.tz, sent });
}

export async function onRequestDelete({ env, request }) {
  if (!sameOrigin(request)) return fail("Bad origin", 403);
  const { endpoint } = await readJson(request), cfg = await getCfg(env);
  cfg.subs = cfg.subs.filter((s) => s.endpoint !== endpoint);
  await putCfg(env, cfg);
  return json({ ok: true, devices: cfg.subs.length });
}

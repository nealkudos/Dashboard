// /api/cron/lean — called by the GitHub Actions schedule (.github/workflows/lean-reminder.yml) a few times each evening.
// Public on purpose: it holds no data and does at most one thing per day — sends the 9:30pm reminder if it's due
// and today's check-in isn't finished. Calling it again (or early) does nothing.
import { json, kv } from "../../_lib/core.js";
import { getCfg, putCfg, localNow, reminderFor, sendAll } from "../../_lib/lean.js";

export async function onRequest({ env }) {
  const cfg = await getCfg(env);
  if (!cfg.subs.length) return json({ ok: true, did: "no devices" });
  const { date, hm } = localNow(cfg.tz);
  if (cfg.lastSent === date) return json({ ok: true, did: "already sent today" });
  if (hm < cfg.time) return json({ ok: true, did: `not yet (${hm} in ${cfg.tz})` });

  const doc = await kv(env).get("block:lean", "json");
  const msg = reminderFor(doc, date);
  cfg.lastSent = date;
  if (!msg) { await putCfg(env, cfg); return json({ ok: true, did: "nothing left to do today" }); }
  const sent = await sendAll(env, cfg, msg);
  await putCfg(env, cfg);
  return json({ ok: true, did: `sent to ${sent} device(s)` });
}

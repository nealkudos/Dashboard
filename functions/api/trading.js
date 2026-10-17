// /api/trading — trade data for the Trading block, fetched server-side from the signal-copier bot.
// Signed-in only (the middleware guards everything under /api/). The bot's password stays here on
// Cloudflare and never reaches the browser.
//
// Cloudflare → Settings → Variables and secrets:
//   COPIER_URL       e.g. https://signal-copier-production.up.railway.app   (the bot's Railway address)
//   COPIER_PASSWORD  (Secret) the DASHBOARD_PASSWORD set on Railway
import { json, fail } from "../_lib/core.js";

export async function onRequestGet({ request, env }) {
  let base = String(env.COPIER_URL || "").trim().replace(/\/+$/, "");
  // Railway shows the address without "https://" - add it if it was pasted that way
  if (base && !/^[a-z]+:\/\//i.test(base)) base = "https://" + base;
  if (!base || !env.COPIER_PASSWORD) {
    return fail("Trading isn't connected yet — add COPIER_URL and COPIER_PASSWORD in Cloudflare.", 503);
  }
  if (!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) return fail("COPIER_URL must start with https://", 500);

  const days = Math.max(1, Math.min(90, parseInt(new URL(request.url).searchParams.get("days"), 10) || 7));
  let res;
  try {
    res = await fetch(`${base}/api/data?days=${days}`, {
      headers: { authorization: "Basic " + btoa("dashboard:" + env.COPIER_PASSWORD), accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return fail("Couldn't reach the trading bot — it may be restarting. Try again in a minute.", 502);
  }
  if (res.status === 401) return fail("The trading bot didn't accept the password — check COPIER_PASSWORD.", 502);

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { return fail(`Trading bot replied with something unexpected (${res.status}).`, 502); }
  if (!res.ok || data.error) return fail(data.error || `Trading bot error (${res.status}).`, 502);
  return json({ ok: true, data }, 200, { "cache-control": "no-store" });
}

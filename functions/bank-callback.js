// /bank-callback — where the bank sends you back after you approve access.
// This page is public because your login cookie isn't sent on a redirect coming from another
// site. It's safe: it only accepts the one-time "state" created when you (signed in) pressed Connect.
import { finishConnect, syncAll } from "./_lib/banking.js";

const page = (title, msg, ok) => new Response(`<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/app.css"><title>${title}</title></head>
<body><div class="auth-wrap"><div class="auth-card">
<div class="brand"><div class="brand-mark">N</div><div class="brand-name">Budget</div></div>
<h2 style="font-size:21px;margin-bottom:6px">${title}</h2><p class="muted">${msg}</p>
<a class="btn" id="go" href="/dashboard/budget/${ok ? "?connected=1" : ""}" style="margin-top:14px;width:100%">Back to Budget</a>
</div></div>${ok ? '<script src="/assets/go-budget.js"></script>' : ""}</body></html>`,
  { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function onRequestGet({ request, env, waitUntil }) {
  const q = new URL(request.url).searchParams;
  if (q.get("error")) {
    return page("Not connected", esc(q.get("error_description") || "The bank sign-in was cancelled."), false);
  }
  try {
    const r = await finishConnect(env, q.get("state"), q.get("code"));
    waitUntil(syncAll(env, { force: true }).catch(() => {}));
    return page(`${esc(r.bank)} connected`, `${r.accounts} account${r.accounts === 1 ? "" : "s"} linked. Pulling in the last 90 days now…`, true);
  } catch (e) {
    return page("Couldn't connect", esc(e.message), false);
  }
}

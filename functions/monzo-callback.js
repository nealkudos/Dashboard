// /monzo-callback — where Monzo sends you back after signing in.
// Public because your login cookie isn't sent on a redirect coming from another site.
// It's safe: it only accepts the one-time "state" created when you (signed in) pressed Connect Monzo.
import { monzoFinish } from "./_lib/monzo.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const page = (title, msg, ok) => new Response(`<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/app.css"><title>${title}</title></head>
<body><div class="auth-wrap"><div class="auth-card">
<div class="brand"><div class="brand-mark">N</div><div class="brand-name">Budget</div></div>
<h2 style="font-size:21px;margin-bottom:6px">${title}</h2><p class="muted">${msg}</p>
<a class="btn" id="go" href="/dashboard/budget/${ok ? "?monzo=1" : ""}" style="margin-top:14px;width:100%">${ok ? "I've approved it — continue" : "Back to Budget"}</a>
</div></div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = url.searchParams;
  if (q.get("error")) return page("Not connected", esc(q.get("error_description") || "The Monzo sign-in was cancelled."), false);
  try {
    await monzoFinish(env, q.get("state"), q.get("code"), url.origin);
    return page("Now approve in the Monzo app",
      "Open the Monzo app on your phone — there's a notification asking to allow access. Approve it with your PIN or Face ID, then tap continue.", true);
  } catch (e) {
    return page("Couldn't connect Monzo", esc(e.message), false);
  }
}

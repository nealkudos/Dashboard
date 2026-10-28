// Runs before every request: guards /dashboard and private APIs, adds security headers.
import { currentSession, fail } from "./_lib/core.js";

const PUBLIC_API = /^\/api\/auth\//;

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; " +
    "connect-src 'self'; font-src 'self' data:; frame-src https://kudos-jobs-board-j5fr.pages.grok.bot; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(self)",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-robots-tag": "noindex, nofollow",
};

function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v);
  return r;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // One address only: www.nealchauhan.co.uk -> nealchauhan.co.uk (keeps sign-in and the Monzo return link on the same site)
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }

  const isDashboard = path === "/dashboard" || path.startsWith("/dashboard/");
  const isPrivateApi = path.startsWith("/api/") && !PUBLIC_API.test(path);

  if (isDashboard || isPrivateApi) {
    let sess = null;
    try { sess = await currentSession(request, env); } catch (e) { return fail(e.message, 500); }
    if (!sess) {
      if (isPrivateApi) return withHeaders(fail("Signed out", 401));
      return withHeaders(Response.redirect(new URL("/", request.url).toString(), 302), { "cache-control": "no-store" });
    }
    context.data.user = sess.user;
    context.data.sessionId = sess.id;
    // Never let a browser or the CDN cache a private page.
    return withHeaders(await next(), { "cache-control": "no-store, private" });
  }

  return withHeaders(await next());
}

// Shared server helpers: responses, cookies, KV records, sessions, rate limits, rotation policy.
import { randomId, sha256Hex, normaliseRecovery } from "./crypto.js";

export const SESSION_COOKIE = "__Host-dash_sid";
export const SESSION_TTL = 60 * 60 * 12; // 12 hours
const USER_KEY = "user";

// ---------- HTTP ----------
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export const fail = (message, status = 400) => json({ ok: false, error: message }, status);

export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

export function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export function sessionCookie(id, maxAge = SESSION_TTL) {
  return `${SESSION_COOKIE}=${id}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "local";
}

// Reject cross-site POSTs (belt and braces on top of SameSite=Strict).
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

// ---------- Settings ----------
export function policy(env) {
  const days = Math.max(1, parseInt(env.ROTATE_DAYS || "30", 10) || 30);
  return {
    days,
    ms: days * 86400000,
    rotateMfa: String(env.ROTATE_MFA ?? "true").toLowerCase() !== "false",
  };
}

export function needsRotation(user, env, now = Date.now()) {
  const p = policy(env);
  return now - (user.passChangedAt || 0) >= p.ms;
}

export function daysLeft(user, env, now = Date.now()) {
  const p = policy(env);
  return Math.max(0, Math.ceil(((user.passChangedAt || 0) + p.ms - now) / 86400000));
}

// ---------- KV records ----------
function kv(env) {
  if (!env.DASH_KV) throw new Error("KV binding DASH_KV is missing — see README step 2.");
  return env.DASH_KV;
}

export const getUser = async (env) => kv(env).get(USER_KEY, "json");
export const putUser = async (env, user) => kv(env).put(USER_KEY, JSON.stringify(user));

export async function putTemp(env, prefix, data, ttl) {
  const id = randomId(24);
  await kv(env).put(`${prefix}:${id}`, JSON.stringify(data), { expirationTtl: Math.max(60, ttl) });
  return id;
}

export async function getTemp(env, prefix, id) {
  if (!/^[a-f0-9]{48,64}$/.test(String(id || ""))) return null;
  return kv(env).get(`${prefix}:${id}`, "json");
}

export async function updateTemp(env, prefix, id, data, ttl) {
  await kv(env).put(`${prefix}:${id}`, JSON.stringify(data), { expirationTtl: Math.max(60, ttl) });
}

export const delTemp = (env, prefix, id) => kv(env).delete(`${prefix}:${id}`);

// ---------- Sessions ----------
export async function createSession(env, user) {
  const id = randomId(32);
  await kv(env).put(
    `sess:${id}`,
    JSON.stringify({ epoch: user.sessionEpoch, created: Date.now() }),
    { expirationTtl: SESSION_TTL }
  );
  return id;
}

/** Returns { user } when the request carries a valid session, else null. */
export async function currentSession(request, env) {
  const id = getCookie(request, SESSION_COOKIE);
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const sess = await kv(env).get(`sess:${id}`, "json");
  if (!sess) return null;
  const user = await getUser(env);
  if (!user || sess.epoch !== user.sessionEpoch) return null; // signed out everywhere / rotated
  if (needsRotation(user, env)) return null; // 30 days up — must sign in and rotate
  return { id, user };
}

export const destroySession = (env, id) => kv(env).delete(`sess:${id}`);

// ---------- Rate limiting (failed attempts per IP) ----------
const RL_MAX = 8;
const RL_WINDOW = 15 * 60;

export async function isLocked(env, request) {
  const n = parseInt((await kv(env).get(`rl:${clientIp(request)}`)) || "0", 10);
  return n >= RL_MAX;
}

export async function noteFailure(env, request) {
  const key = `rl:${clientIp(request)}`;
  const n = parseInt((await kv(env).get(key)) || "0", 10) + 1;
  await kv(env).put(key, String(n), { expirationTtl: RL_WINDOW });
}

export const clearFailures = (env, request) => kv(env).delete(`rl:${clientIp(request)}`);

// ---------- Recovery codes ----------
export async function hashRecoveryCodes(codes) {
  return Promise.all(codes.map((c) => sha256Hex(normaliseRecovery(c))));
}

export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 12) return "Password must be at least 12 characters.";
  if (pw.length > 200) return "Password is too long.";
  return null;
}

export function blockKey(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id || ""))) return null;
  return `block:${id}`;
}

export { kv };

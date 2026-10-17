// /api/auth/* — setup, login, second factor, 30-day rotation, logout.
import {
  json, fail, readJson, sameOrigin, policy, needsRotation, daysLeft,
  getUser, putUser, putTemp, getTemp, updateTemp, delTemp,
  createSession, currentSession, destroySession, sessionCookie,
  isLocked, noteFailure, clearFailures, hashRecoveryCodes, passwordProblem,
} from "../../_lib/core.js";
import {
  hashPassword, verifyPassword, newTotpSecret, verifyTotp, otpauthUri,
  newRecoveryCodes, normaliseRecovery, sha256Hex, timingSafeEqual, randomId,
} from "../../_lib/crypto.js";

const CHALLENGE_TTL = 10 * 60;
const GENERIC = "Those details didn't match.";

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = params.action;
  try {
    if (request.method === "GET" && action === "status") return status(request, env);
    if (request.method !== "POST") return fail("Not found", 404);
    if (!sameOrigin(request)) return fail("Bad origin", 403);
    const body = await readJson(request);
    switch (action) {
      case "setup": return setup(request, env, body);
      case "login": return login(request, env, body);
      case "verify": return verify(request, env, body);
      case "rotate": return rotate(request, env, body);
      case "rotate-now": return rotateNow(request, env);
      case "logout": return logout(request, env, body);
      default: return fail("Not found", 404);
    }
  } catch (err) {
    return fail(err.message || "Server error", 500);
  }
}

// GET /api/auth/status — is the site set up, am I signed in?
async function status(request, env) {
  const user = await getUser(env);
  const sess = user ? await currentSession(request, env) : null;
  return json({
    ok: true,
    setUp: !!user,
    signedIn: !!sess,
    email: sess ? user.email : undefined,
    daysLeft: sess ? daysLeft(user, env) : undefined,
    rotateDays: policy(env).days,
  });
}

// POST /api/auth/setup — first run only, guarded by the SETUP_TOKEN secret.
//   step "start":  { setupToken, email, password }   -> { pending, otpauth, secret }
//   step "finish": { pending, code }                 -> { recoveryCodes } + session cookie
async function setup(request, env, body) {
  if (await getUser(env)) return fail("Already set up.", 409);
  if (await isLocked(env, request)) return fail("Too many attempts. Try again in 15 minutes.", 429);

  if (body.step === "start") {
    if (!env.SETUP_TOKEN) return fail("SETUP_TOKEN secret isn't set on the server — see README.", 500);
    if (!timingSafeEqual(String(body.setupToken || ""), env.SETUP_TOKEN)) {
      await noteFailure(env, request);
      return fail("Setup token is wrong.", 401);
    }
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Enter a valid email.");
    const problem = passwordProblem(body.password);
    if (problem) return fail(problem);
    const secret = newTotpSecret();
    const pending = await putTemp(env, "setup", {
      email, passHash: await hashPassword(body.password), secret,
    }, CHALLENGE_TTL);
    return json({ ok: true, pending, secret, otpauth: otpauthUri(secret, email) });
  }

  if (body.step === "finish") {
    const p = await getTemp(env, "setup", body.pending);
    if (!p) return fail("Setup expired — start again.", 410);
    const step = await verifyTotp(p.secret, body.code);
    if (step < 0) {
      await noteFailure(env, request);
      return fail("That code didn't work. Check your phone's clock and try the newest code.");
    }
    const codes = newRecoveryCodes();
    const now = Date.now();
    const user = {
      email: p.email,
      passHash: p.passHash,
      totpSecret: p.secret,
      lastStep: step,
      passChangedAt: now,
      mfaChangedAt: now,
      recovery: await hashRecoveryCodes(codes),
      sessionEpoch: randomId(8),
      createdAt: now,
    };
    await putUser(env, user);
    await delTemp(env, "setup", body.pending);
    await clearFailures(env, request);
    const sid = await createSession(env, user);
    return json({ ok: true, recoveryCodes: codes }, 200, { "set-cookie": sessionCookie(sid) });
  }

  return fail("Unknown step.");
}

// POST /api/auth/login — { email, password } -> { challenge }
async function login(request, env, body) {
  if (await isLocked(env, request)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const user = await getUser(env);
  if (!user) return fail("Not set up yet.", 409);
  const email = String(body.email || "").trim().toLowerCase();
  const okPass = await verifyPassword(String(body.password || ""), user.passHash);
  if (!okPass || !timingSafeEqual(email, user.email)) {
    await noteFailure(env, request);
    return fail(GENERIC, 401);
  }
  const challenge = await putTemp(env, "chal", { stage: "mfa" }, CHALLENGE_TTL);
  return json({ ok: true, challenge });
}

// POST /api/auth/verify — { challenge, code } or { challenge, recovery }
//   -> signed in, or { rotate: true, ... } when the 30 days are up
async function verify(request, env, body) {
  if (await isLocked(env, request)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const chal = await getTemp(env, "chal", body.challenge);
  if (!chal || chal.stage !== "mfa") return fail("Sign-in expired — start again.", 410);
  const user = await getUser(env);

  let usedRecovery = false;
  if (body.recovery) {
    const h = await sha256Hex(normaliseRecovery(body.recovery));
    const idx = user.recovery.findIndex((x) => timingSafeEqual(x, h));
    if (idx < 0) { await noteFailure(env, request); return fail("That recovery code isn't valid.", 401); }
    user.recovery.splice(idx, 1);
    usedRecovery = true;
  } else {
    const step = await verifyTotp(user.totpSecret, body.code, user.lastStep || -1);
    if (step < 0) { await noteFailure(env, request); return fail("That code didn't work.", 401); }
    user.lastStep = step;
  }
  await putUser(env, user);
  await clearFailures(env, request);

  if (needsRotation(user, env)) {
    return startRotation(env, body.challenge, user, "expired");
  }
  await delTemp(env, "chal", body.challenge);
  const sid = await createSession(env, user);
  return json(
    { ok: true, signedIn: true, recoveryLeft: user.recovery.length, usedRecovery },
    200,
    { "set-cookie": sessionCookie(sid) }
  );
}

async function startRotation(env, challengeId, user, reason) {
  const p = policy(env);
  const newSecret = p.rotateMfa || reason === "manual" ? newTotpSecret() : null;
  await updateTemp(env, "chal", challengeId, { stage: "rotate", newSecret, reason }, CHALLENGE_TTL);
  return json({
    ok: true,
    rotate: true,
    reason,
    days: p.days,
    challenge: challengeId,
    newMfa: !!newSecret,
    secret: newSecret || undefined,
    otpauth: newSecret ? otpauthUri(newSecret, user.email) : undefined,
  });
}

// POST /api/auth/rotate-now — signed-in user chooses to rotate early.
async function rotateNow(request, env) {
  const sess = await currentSession(request, env);
  if (!sess) return fail("Sign in first.", 401);
  const challenge = await putTemp(env, "chal", { stage: "pending" }, CHALLENGE_TTL);
  return startRotation(env, challenge, sess.user, "manual");
}

// POST /api/auth/rotate — { challenge, password, code? } -> new recovery codes + session
async function rotate(request, env, body) {
  if (await isLocked(env, request)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const chal = await getTemp(env, "chal", body.challenge);
  if (!chal || chal.stage !== "rotate") return fail("This expired — sign in again.", 410);
  const user = await getUser(env);

  const problem = passwordProblem(body.password);
  if (problem) return fail(problem);
  if (await verifyPassword(body.password, user.passHash)) return fail("Choose a password you haven't just used.");

  const now = Date.now();
  if (chal.newSecret) {
    const step = await verifyTotp(chal.newSecret, body.code);
    if (step < 0) { await noteFailure(env, request); return fail("That code from the new authenticator entry didn't work."); }
    user.totpSecret = chal.newSecret;
    user.lastStep = step;
    user.mfaChangedAt = now;
  }
  const codes = newRecoveryCodes();
  user.passHash = await hashPassword(body.password);
  user.passChangedAt = now;
  user.recovery = await hashRecoveryCodes(codes);
  user.sessionEpoch = randomId(8); // signs out every other device
  await putUser(env, user);
  await delTemp(env, "chal", body.challenge);
  await clearFailures(env, request);

  const sid = await createSession(env, user);
  return json(
    { ok: true, signedIn: true, recoveryCodes: codes, newMfa: !!chal.newSecret },
    200,
    { "set-cookie": sessionCookie(sid) }
  );
}

// POST /api/auth/logout — { everywhere?: true }
async function logout(request, env, body) {
  const sess = await currentSession(request, env);
  if (sess) {
    await destroySession(env, sess.id);
    if (body.everywhere) {
      sess.user.sessionEpoch = randomId(8);
      await putUser(env, sess.user);
    }
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

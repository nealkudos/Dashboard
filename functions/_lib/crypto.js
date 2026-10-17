// Crypto helpers — all WebCrypto, no dependencies.

const enc = new TextEncoder();

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function randomId(bytes = 32) {
  return toHex(randomBytes(bytes));
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

export async function sha256Hex(str) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(str)));
}

// ---------- Password hashing (PBKDF2-SHA256) ----------
// Cloudflare Workers caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITER = 100000;

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : randomBytes(16);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITER}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [, , saltHex] = stored.split("$");
  const candidate = await hashPassword(password, saltHex);
  return timingSafeEqual(candidate, stored);
}

// ---------- Base32 (RFC 4648) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------
export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

async function hotp(secretB32, counter) {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secretB32),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = h[h.length - 1] & 15;
  const code =
    (((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/**
 * Checks a 6-digit code, allowing ±1 step of clock drift.
 * Returns the matched time step (so callers can block replays) or -1.
 */
export async function verifyTotp(secretB32, code, lastStep = -1, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ""))) return -1;
  const step = Math.floor(now / 1000 / 30);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue; // already used — replay
    if (timingSafeEqual(await hotp(secretB32, s), String(code))) return s;
  }
  return -1;
}

export function otpauthUri(secret, account, issuer = "Neal Dashboard") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- Recovery codes ----------
export function newRecoveryCodes(n = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const s = [...b].map((x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export function normaliseRecovery(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

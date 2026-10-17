// Homepage sign-in flow: setup → authenticator → recovery codes; login → code; 30-day rotation.
const $ = (id) => document.getElementById(id);
const msg = $("msg");
let state = { mode: null, pending: null, challenge: null };

function show(stage) {
  document.querySelectorAll(".stage").forEach((s) => (s.hidden = s.dataset.stage !== stage));
  const first = document.querySelector(`.stage[data-stage="${stage}"] input:not([hidden])`);
  if (first) setTimeout(() => first.focus(), 30);
}
function say(text, kind = "err") { msg.textContent = text || ""; msg.className = `msg ${text ? kind : ""}`; }

async function api(path, body) {
  const res = await fetch(`/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Unexpected server response." }));
  if (!res.ok || !data.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function busy(form, fn) {
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true; say("");
  try { await fn(); } catch (e) { say(e.message); } finally { btn.disabled = false; }
}

function drawQr(uri, secret) {
  const qr = qrcode(0, "M"); // global from qrcode.js
  qr.addData(uri); qr.make();
  $("qr").innerHTML = qr.createImgTag(6, 0, "Authenticator QR code");
  $("secret").textContent = secret.replace(/(.{4})/g, "$1 ").trim();
}

function showCodes(codes) {
  $("codes").innerHTML = codes.map((c) => `<div>${c}</div>`).join("");
  show("codes");
}

// ---------- Boot ----------
(async function boot() {
  try {
    // Started from the dashboard's "change now" menu item
    const early = sessionStorage.getItem("dash-rotate");
    if (early) {
      sessionStorage.removeItem("dash-rotate");
      return startRotation(JSON.parse(early));
    }
    const s = await api("status");
    if (s.signedIn) return location.replace("/dashboard/");
    show(s.setUp ? "login" : "setup");
  } catch (e) {
    show("login"); say(e.message);
  }
})();

// ---------- First-time setup ----------
$("f-setup").addEventListener("submit", (ev) => {
  ev.preventDefault();
  busy(ev.target, async () => {
    const r = await api("setup", {
      step: "start",
      setupToken: $("s-token").value,
      email: $("s-email").value,
      password: $("s-pass").value,
    });
    state = { mode: "setup", pending: r.pending };
    $("enrol-title").textContent = "Add your authenticator";
    $("enrol-pass-wrap").hidden = true;
    drawQr(r.otpauth, r.secret);
    show("enrol");
  });
});

// ---------- Authenticator confirm (setup or rotation) ----------
$("f-enrol").addEventListener("submit", (ev) => {
  ev.preventDefault();
  busy(ev.target, async () => {
    const code = $("e-code").value.trim();
    if (state.mode === "setup") {
      const r = await api("setup", { step: "finish", pending: state.pending, code });
      showCodes(r.recoveryCodes);
    } else {
      const r = await api("rotate", { challenge: state.challenge, password: $("e-pass").value, code });
      showCodes(r.recoveryCodes);
    }
  });
});

// ---------- Sign in ----------
$("f-login").addEventListener("submit", (ev) => {
  ev.preventDefault();
  busy(ev.target, async () => {
    const r = await api("login", { email: $("l-email").value, password: $("l-pass").value });
    state = { mode: "login", challenge: r.challenge };
    $("l-pass").value = "";
    show("mfa");
  });
});

let useRecovery = false;
$("toggle-rec").addEventListener("click", () => {
  useRecovery = !useRecovery;
  $("mfa-code-wrap").hidden = useRecovery;
  $("mfa-rec-wrap").hidden = !useRecovery;
  $("toggle-rec").textContent = useRecovery ? "Use authenticator code instead" : "Lost your phone? Use a recovery code";
  say("");
  (useRecovery ? $("m-rec") : $("m-code")).focus();
});

$("f-mfa").addEventListener("submit", (ev) => {
  ev.preventDefault();
  busy(ev.target, async () => {
    const body = { challenge: state.challenge };
    if (useRecovery) body.recovery = $("m-rec").value; else body.code = $("m-code").value.trim();
    const r = await api("verify", body);
    if (r.rotate) return startRotation(r);
    if (r.usedRecovery) {
      sessionStorage.setItem("dash-flash", `Recovery code used — ${r.recoveryLeft} left. Consider changing your authenticator from the menu.`);
    }
    location.replace("/dashboard/");
  });
});

// Auto-submit when 6 digits typed
for (const id of ["m-code", "e-code"]) {
  $(id).addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    if (e.target.value.length === 6 && (id === "m-code" || $("enrol-pass-wrap").hidden || $("e-pass").value.length >= 8)) {
      e.target.form.requestSubmit();
    }
  });
}

// ---------- 30-day rotation ----------
function startRotation(r) {
  state = { mode: "rotate", challenge: r.challenge };
  const why = r.reason === "manual"
    ? "Choose a new password and add a fresh authenticator entry."
    : `It's been ${r.days} days. Choose a new password${r.newMfa ? " and re-add your authenticator" : ""}.`;
  if (r.newMfa) {
    $("enrol-title").textContent = r.reason === "manual" ? "Change password & authenticator" : `${r.days}-day security change`;
    $("enrol-pass-wrap").hidden = false;
    $("e-pass").required = true;
    drawQr(r.otpauth, r.secret);
    show("enrol");
    say(why + " Delete the old entry from your app afterwards.", "ok");
    setTimeout(() => $("e-pass").focus(), 40);
  } else {
    $("rotate-pass-hint").textContent = why;
    show("rotate-pass");
  }
}

$("f-rotate-pass").addEventListener("submit", (ev) => {
  ev.preventDefault();
  busy(ev.target, async () => {
    const r = await api("rotate", { challenge: state.challenge, password: $("r-pass").value });
    showCodes(r.recoveryCodes);
  });
});

// ---------- Recovery codes ----------
$("copy-codes").addEventListener("click", async () => {
  const text = [...$("codes").children].map((d) => d.textContent).join("\n");
  try { await navigator.clipboard.writeText(text); say("Copied.", "ok"); } catch { say("Couldn't copy — select them manually."); }
});
$("codes-done").addEventListener("click", () => location.replace("/dashboard/"));

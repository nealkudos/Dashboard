// Dashboard shell: loads blocks from blocks/registry.js, lays them out, handles edit mode + menu.
import BLOCKS from "./blocks/registry.js";

const $ = (id) => document.getElementById(id);
const grid = $("grid");
let prefs = { order: [], sizes: {}, hidden: [] };
let me = null;
const cleanups = new Map();

// ---------- API ----------
async function call(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: opts.body ? { "content-type": "application/json" } : {},
    ...opts,
  });
  if (res.status === 401) { location.replace("/"); throw new Error("Signed out"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const savePrefs = () =>
  call("/api/prefs", { method: "PUT", body: JSON.stringify({ prefs }) }).catch((e) => flash(e.message));

function flash(text) {
  const f = $("flash");
  f.textContent = text; f.hidden = !text;
}

// Context object every block receives.
function makeCtx(block) {
  const timers = [];
  return {
    user: me,
    /** Load this block's saved data (or `fallback` if none yet). */
    async load(fallback = null) {
      const r = await call(`/api/blocks/${block.id}`);
      return r.data ?? fallback;
    },
    /** Save any JSON-able data for this block (max 100 KB). */
    save(data) {
      return call(`/api/blocks/${block.id}`, { method: "PUT", body: JSON.stringify({ data }) });
    },
    /** Call one of your own /api/ endpoints (signed-in). Pass a body object to send JSON. */
    api(path, { method, body } = {}) {
      return call(path, {
        method: method || (body ? "POST" : "GET"),
        body: body ? JSON.stringify(body) : undefined,
      });
    },
    /** Run fn now and every `ms` milliseconds; stopped automatically. */
    every(ms, fn) { fn(); timers.push(setInterval(fn, ms)); },
    _stop() { timers.forEach(clearInterval); },
  };
}

// ---------- Layout ----------
function orderedBlocks() {
  const ids = BLOCKS.map((b) => b.id);
  const order = prefs.order.filter((id) => ids.includes(id));
  for (const id of ids) if (!order.includes(id)) order.push(id); // new blocks appear at the end
  return order.map((id) => BLOCKS.find((b) => b.id === id));
}

function sizeOf(b) { return prefs.sizes[b.id] || b.size || "s"; }

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

// ---------- Column layout ----------
// Blocks are stacked into columns (2 on iPad/desktop, 1 on phone). Each block goes into
// whichever column is currently shortest, keeping your order, so there are no big gaps.
// Two small ("S") blocks next to each other share a row side by side.
let cards = [];
let layoutTimer = null;

function makeCols(n) {
  if (grid.children.length === n && [...grid.children].every((c) => c.classList.contains("col"))) return [...grid.children];
  grid.innerHTML = "";
  return Array.from({ length: n }, () => { const c = el("div", { class: "col" }); grid.append(c); return c; });
}

function layout() {
  layoutTimer = null;
  const active = document.activeElement;
  if (active && active.closest && active.closest(".block") && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    active.addEventListener("blur", queueLayout, { once: true }); // don't move a block while you're typing in it
    return;
  }
  const n = grid.clientWidth >= 720 ? 2 : 1;
  const cols = makeCols(n);
  const editing = document.body.classList.contains("editing");
  const visible = cards.filter((c) => editing || !c.classList.contains("is-hidden"));

  // Group into units: two neighbouring small blocks share a row (when there's room).
  const units = [];
  for (let i = 0; i < visible.length; i++) {
    const a = visible[i], b = visible[i + 1];
    if (n > 1 && a.dataset.size === "s" && b && b.dataset.size === "s") { units.push([a, b]); i++; }
    else units.push([a]);
  }
  for (const u of units) for (const c of u) c.classList.toggle("half", u.length === 2);

  // Make sure every card is in the DOM so it can be measured (width doesn't depend on column).
  for (const c of cards) if (!c.parentElement || !c.parentElement.classList.contains("col")) cols[0].append(c);

  const heights = Array(n).fill(0);
  const plan = units.map((u) => {
    const h = Math.max(...u.map((c) => c.offsetHeight)) + 16;
    let k = 0;
    for (let i = 1; i < n; i++) if (heights[i] < heights[k] - 24) k = i; // prefer left unless clearly shorter
    heights[k] += h;
    return k;
  });

  // Only touch the DOM if something actually needs to move.
  const want = cols.map(() => []);
  units.forEach((u, i) => want[plan[i]].push(...u));
  cards.filter((c) => !visible.includes(c)).forEach((c) => want[0].push(c));
  want.forEach((list, k) => {
    const same = list.length === cols[k].children.length && list.every((c, i) => cols[k].children[i] === c);
    if (!same) list.forEach((c) => cols[k].append(c));
  });
}

function queueLayout() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(layout, 60);
}
const sizeWatch = new ResizeObserver(queueLayout);
window.addEventListener("resize", queueLayout);

async function renderAll() {
  for (const [, c] of cleanups) c();
  cleanups.clear();
  sizeWatch.disconnect();
  grid.innerHTML = "";
  cards = [];

  for (const block of orderedBlocks()) {
    const body = el("div", { class: "block-body" });
    const tools = el("div", { class: "block-tools" },
      el("button", { title: "Move earlier", onclick: () => move(block.id, -1) }, "◀"),
      el("button", { title: "Move later", onclick: () => move(block.id, 1) }, "▶"),
      el("button", { title: "Change size", onclick: () => cycleSize(block.id) }, sizeOf(block).toUpperCase()),
      el("button", { title: "Show / hide", onclick: () => toggleHidden(block.id) }, prefs.hidden.includes(block.id) ? "Show" : "Hide"),
    );
    const card = el("section", {
      class: `block${prefs.hidden.includes(block.id) ? " is-hidden" : ""}`,
      "data-block": block.id,
      "data-size": sizeOf(block),
    },
      el("div", { class: "block-head" }, el("span", { class: "title" }, block.title), tools),
      body,
    );
    cards.push(card);
    sizeWatch.observe(card);

    // Render blocks in parallel so one slow block doesn't hold up the rest.
    const ctx = makeCtx(block);
    cleanups.set(block.id, () => ctx._stop());
    Promise.resolve()
      .then(() => block.render(body, ctx))
      .then((cleanup) => {
        if (typeof cleanup === "function") cleanups.set(block.id, () => { ctx._stop(); cleanup(); });
      })
      .catch((e) => {
        body.innerHTML = "";
        body.append(el("div", { class: "block-error" }, `This block failed to load: ${e.message}`));
      });
  }
  layout();
}

function currentOrder() { return orderedBlocks().map((b) => b.id); }

function move(id, dir) {
  const order = currentOrder();
  const i = order.indexOf(id), j = i + dir;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  prefs.order = order;
  savePrefs(); renderAll();
}

function cycleSize(id) {
  const block = BLOCKS.find((b) => b.id === id);
  const next = { s: "m", m: "l", l: "s" }[sizeOf(block)];
  prefs.sizes[id] = next;
  savePrefs(); renderAll();
}

function toggleHidden(id) {
  prefs.hidden = prefs.hidden.includes(id) ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id];
  savePrefs(); renderAll();
}

function setEditing(on) {
  document.body.classList.toggle("editing", on);
  $("editbar").hidden = !on;
  queueLayout();
}

// ---------- Menu ----------
const menu = $("menu"), menuBtn = $("menu-btn");
menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  menuBtn.setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", (e) => { if (!menu.contains(e.target)) menu.hidden = true; });

$("m-edit").onclick = () => { menu.hidden = true; setEditing(true); };
$("e-done").onclick = () => setEditing(false);
$("e-reset").onclick = () => { prefs = { order: [], sizes: {}, hidden: [] }; savePrefs(); renderAll(); };

$("m-rotate").onclick = async () => {
  try {
    const r = await call("/api/auth/rotate-now", { method: "POST", body: "{}" });
    sessionStorage.setItem("dash-rotate", JSON.stringify(r));
    location.href = "/";
  } catch (e) { flash(e.message); }
};

async function signOut(everywhere) {
  await call("/api/auth/logout", { method: "POST", body: JSON.stringify({ everywhere }) }).catch(() => {});
  location.replace("/");
}
$("m-logout").onclick = () => signOut(false);
$("m-logout-all").onclick = () => signOut(true);

// ---------- Boot ----------
(async function boot() {
  const s = await call("/api/auth/status");
  if (!s.signedIn) return location.replace("/");
  me = { email: s.email, daysLeft: s.daysLeft, rotateDays: s.rotateDays };
  $("rotate-note").textContent = `Next security change in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}`;

  const f = sessionStorage.getItem("dash-flash");
  if (f) { sessionStorage.removeItem("dash-flash"); flash(f); }
  else if (s.daysLeft <= 3) flash(`Heads up: your password and authenticator change is due in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}.`);

  try { prefs = { order: [], sizes: {}, hidden: [], ...(await call("/api/prefs")).prefs }; } catch {}
  await renderAll();
})();

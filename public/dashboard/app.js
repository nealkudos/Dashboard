// Dashboard shell: loads blocks from blocks/registry.js, lays them out, handles edit mode + menu.
import BLOCKS from "./blocks/registry.js";

const $ = (id) => document.getElementById(id);
let prefs = { layout: {}, hidden: [] };
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
// Blocks sit on a 12-column grid. In Edit layout you drag a block by its title bar
// and resize it from a bottom corner; positions are saved to your account.
// Phones show one column in the same top-to-bottom order.
const GS = window.GridStack && (window.GridStack.GridStack || window.GridStack);
const CELL = 44;

// Starting positions (x, y, width, height in grid units) until you move things.
const DEFAULTS = {
  welcome:  { x: 0, y: 0,  w: 6, h: 4 },
  calendar: { x: 6, y: 0,  w: 6, h: 13 },
  trading:  { x: 0, y: 4,  w: 6, h: 7 },
  scanner:  { x: 0, y: 11, w: 3, h: 6 },
  links:    { x: 3, y: 11, w: 3, h: 6 },
  notes:    { x: 6, y: 13, w: 6, h: 5 },
};
const SIZE_DEFAULT = { s: { w: 3, h: 6 }, m: { w: 6, h: 6 }, l: { w: 12, h: 6 } };

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

const isEditing = () => document.body.classList.contains("editing");

let gs = null;
function grid() {
  if (gs) return gs;
  gs = GS.init({
    column: 12,
    cellHeight: CELL,
    margin: 8,
    float: false,            // blocks slide up to fill gaps, like phone widgets
    animate: true,
    staticGrid: true,        // locked until you tap Edit layout
    handle: ".block-head",
    alwaysShowResizeHandle: true,
    resizable: { handles: "se,sw" },
    columnOpts: { breakpoints: [{ w: 720, c: 1 }], layout: "list" },
  }, $("grid"));
  gs.on("change", () => { setOrder(); queueSaveLayout(); });
  return gs;
}

// Phone view stacks blocks top-to-bottom using the full-width layout's reading order.
function setOrder() {
  if (!gs || gs.getColumn() !== 12) return;
  for (const n of gs.engine.nodes) n.el.style.order = n.y * 12 + n.x;
}

let saveTimer = null;
function queueSaveLayout() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!gs || gs.getColumn() !== 12) return; // only the full-width layout is saved
    const layout = { ...prefs.layout };
    for (const n of gs.save(false)) if (n.id) layout[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h };
    prefs.layout = layout;
    savePrefs();
  }, 400);
}

function placeFor(block) {
  const saved = prefs.layout[block.id];
  if (saved) return saved;
  if (DEFAULTS[block.id]) return DEFAULTS[block.id];
  return { ...SIZE_DEFAULT[block.size || "s"], autoPosition: true }; // new blocks drop into the first free space
}

async function renderAll() {
  for (const [, c] of cleanups) c();
  cleanups.clear();
  const g = grid();
  g.batchUpdate();
  g.removeAll(true);

  const editing = isEditing();
  for (const block of BLOCKS) {
    const hidden = prefs.hidden.includes(block.id);
    if (hidden && !editing) continue;

    const body = el("div", { class: "block-body" });
    const tools = el("div", { class: "block-tools" },
      el("button", { title: hidden ? "Show on dashboard" : "Hide from dashboard", onclick: () => toggleHidden(block.id) }, hidden ? "Show" : "Hide"),
    );
    const card = el("section", { class: `block${hidden ? " is-hidden" : ""}`, "data-block": block.id },
      el("div", { class: "block-head" }, el("span", { class: "title" }, block.title), tools),
      body,
    );
    const pos = placeFor(block);
    const item = el("div", { class: "grid-stack-item" }, el("div", { class: "grid-stack-item-content" }, card));
    g.addWidget(item, { id: block.id, x: pos.x, y: pos.y, w: pos.w, h: pos.h, autoPosition: !!pos.autoPosition, minW: 2, minH: 3 });

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
  g.batchUpdate(false);
  g.setStatic(!editing);
  // order for the phone view comes from saved/default positions
  for (const n of g.engine.nodes) { const p = placeFor({ id: n.id }); n.el.style.order = (p.y ?? 99) * 12 + (p.x ?? 0); }
  setOrder();
}

function toggleHidden(id) {
  prefs.hidden = prefs.hidden.includes(id) ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id];
  savePrefs(); renderAll();
}

function setEditing(on) {
  document.body.classList.toggle("editing", on);
  $("editbar").hidden = !on;
  if (prefs.hidden.length) renderAll();   // show/hide the hidden blocks so they can be brought back
  else grid().setStatic(!on);
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
$("e-reset").onclick = () => { prefs = { layout: {}, hidden: [] }; savePrefs(); renderAll(); };

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

  try { const p = (await call("/api/prefs")).prefs || {}; prefs = { layout: p.layout || {}, hidden: p.hidden || [] }; } catch {}
  await renderAll();
})();

// Copy this file to start a new block, then add it to registry.js.
//
// A block is an object with:
//   id     — unique, lowercase-with-dashes (also the key its saved data lives under)
//   title  — shown in the block header
//   size   — default width: "s" (1 column), "m" (2 columns) or "l" (full width)
//   render(el, ctx) — draw into `el`. May be async. May return a cleanup function.
//
// ctx gives you:
//   await ctx.load(fallback)   → this block's saved data (private, server-side)
//   await ctx.save(data)       → save any JSON (up to 100 KB)
//   ctx.every(ms, fn)          → run fn now and repeatedly (auto-stopped)
//   ctx.user                   → { email, daysLeft, rotateDays }
//
// Notes: scripts must be files on your site (no inline <script> and no outside
// script URLs — the security policy blocks them). Calls to outside APIs should go
// through a Cloudflare Function in /functions/api/ so keys never reach the browser.

export default {
  id: "my-block",
  title: "My block",
  size: "s",

  async render(el, ctx) {
    const data = await ctx.load({ count: 0 });

    el.innerHTML = `
      <p style="font-size:28px;font-weight:650;margin:0" data-count>${data.count}</p>
      <button data-add>Add one</button>
    `;

    el.querySelector("[data-add]").onclick = async () => {
      data.count++;
      el.querySelector("[data-count]").textContent = data.count;
      await ctx.save(data);
    };
  },
};

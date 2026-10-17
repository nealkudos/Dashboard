// Scratch notes — autosaves to the server a moment after you stop typing.
export default {
  id: "notes",
  title: "Notes",
  size: "s",

  async render(el, ctx) {
    const saved = await ctx.load({ text: "" });
    el.innerHTML = `
      <textarea data-notes placeholder="Jot something down…"
        style="width:100%;height:calc(100% - 1.4em);min-height:120px;display:block;resize:vertical;border:0;outline:none;background:transparent;color:var(--text);font:inherit;font-size:15px;padding:0"></textarea>
      <div data-state class="muted small" style="text-align:right;height:1.2em"></div>`;
    const ta = el.querySelector("[data-notes]");
    const st = el.querySelector("[data-state]");
    ta.value = saved.text || "";

    let t;
    ta.addEventListener("input", () => {
      st.textContent = "…";
      clearTimeout(t);
      t = setTimeout(async () => {
        try { await ctx.save({ text: ta.value }); st.textContent = "Saved"; }
        catch (e) { st.textContent = e.message; }
      }, 700);
    });
    return () => clearTimeout(t);
  },
};

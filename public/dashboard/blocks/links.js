// Quick links you can add/remove; saved privately on the server.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export default {
  id: "links",
  title: "Quick links",
  size: "s",

  async render(el, ctx) {
    let links = await ctx.load([]);

    const draw = () => {
      el.innerHTML = `
        <ul style="list-style:none;margin:0;padding:0;display:grid;gap:4px">
          ${links.map((l, i) => `
            <li style="display:flex;align-items:center;gap:8px">
              <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"
                 style="flex:1;color:var(--text);text-decoration:none;padding:6px 8px;border-radius:8px;background:var(--surface-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.name)}</a>
              <button class="link" data-del="${i}" title="Remove" style="color:var(--muted)">✕</button>
            </li>`).join("") || `<li class="muted small">No links yet.</li>`}
        </ul>
        <form data-add style="display:flex;gap:6px;margin-top:10px">
          <input name="url" placeholder="Paste a link" style="padding:8px 10px;font-size:15px">
          <button style="padding:8px 12px">Add</button>
        </form>`;

      el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
        links.splice(+b.dataset.del, 1); draw(); await ctx.save(links);
      }));

      el.querySelector("[data-add]").onsubmit = async (e) => {
        e.preventDefault();
        let url = e.target.url.value.trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        let name;
        try { name = new URL(url).hostname.replace(/^www\./, ""); } catch { return; }
        const label = prompt("Name for this link", name);
        if (label === null) return;
        links.push({ name: label || name, url });
        draw(); await ctx.save(links);
      };
    };
    draw();
  },
};

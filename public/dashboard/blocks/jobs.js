// Kudos jobs board — the Grok-hosted page, shown inside the dashboard.
const URL_ = "https://kudos-jobs-board-j5fr.pages.grok.bot/";

export default {
  id: "jobs",
  title: "Kudos jobs board",
  size: "l",

  render(el) {
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.gap = "8px";
    el.innerHTML = `
      <div style="display:flex;justify-content:flex-end">
        <a href="${URL_}" target="_blank" rel="noopener noreferrer" class="small" style="color:var(--accent);text-decoration:none;font-weight:600">Open full screen ↗</a>
      </div>
      <iframe src="${URL_}" title="Kudos jobs board" loading="lazy" referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms"
        style="flex:1;min-height:min(70vh,560px);width:100%;border:0;border-radius:12px;background:#fff"></iframe>`;
  },
};

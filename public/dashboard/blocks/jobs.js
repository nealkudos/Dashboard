// Kudos jobs board. The Grok-hosted page won't display inside another site, so for now this opens it;
// once we know where its tasks come from, this block will list them directly.
const URL_ = "https://kudos-jobs-board-j5fr.pages.grok.bot/";

export default {
  id: "jobs",
  title: "Kudos jobs board",
  size: "m",

  render(el) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:4px 0">
        <div class="muted small">Your jobs and tasks board (hosted on Grok).</div>
        <a class="btn" href="${URL_}" target="_blank" rel="noopener noreferrer">Open jobs board ↗</a>
      </div>`;
  },
};

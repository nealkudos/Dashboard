// Placeholder showing where new blocks go. Remove it from registry.js once you've added your own.
export default {
  id: "starter",
  title: "Next block",
  size: "s",

  render(el) {
    el.innerHTML = `
      <div style="height:100%;display:grid;place-items:center;text-align:center;border:1.5px dashed var(--line);border-radius:10px;padding:14px">
        <div>
          <div style="font-size:26px;line-height:1;color:var(--muted)">＋</div>
          <div class="small muted" style="margin-top:6px">Copy <code>blocks/_template.js</code>,<br>then add it in <code>registry.js</code>.</div>
        </div>
      </div>`;
  },
};

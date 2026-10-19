// Football picks — weekly Premier League betting preview. The data file
// (/dashboard/football/picks.json) is rewritten every Friday morning by the
// "Weekend football picks" scheduled task, which commits it to this repo.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (n) => `${Math.round(n)}%`;

const css = `
.fb{display:flex;flex-direction:column;gap:10px;height:100%}
.fb h4{margin:0 0 4px;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.fb .pick{display:flex;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:10px;background:var(--surface-2);font-size:14px}
.fb .pick b{font-weight:600}
.fb .pick .p{font-variant-numeric:tabular-nums;font-weight:650;white-space:nowrap}
.fb .pick .n{display:block;font-size:12px;color:var(--muted)}
.fb .acca{font-size:13px;color:var(--muted);margin-top:4px}
.fb .fx{padding:8px 0;border-top:1px solid var(--line)}
.fb .fx:first-child{border-top:0}
.fb .top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:14px}
.fb .when{font-size:12px;color:var(--muted);white-space:nowrap}
.fb .bar{display:flex;height:6px;border-radius:3px;overflow:hidden;margin:6px 0 3px;background:var(--line)}
.fb .bar .h{background:var(--accent)} .fb .bar .d{background:var(--muted);opacity:.45} .fb .bar .a{background:#c2572b}
.fb .nums{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.fb .take{font-size:12px;color:var(--muted);margin-top:3px}
.fb .tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:6px;vertical-align:1px}
.fb .tag.pick{background:var(--accent);color:var(--accent-ink)}
.fb .tag.skip{background:var(--surface-2);color:var(--muted)}
.fb .tag.overrated,.fb .tag.value{background:#c2572b;color:#fff}
.fb .list{flex:1;min-height:0;overflow:auto}
.fb .foot{font-size:11px;color:var(--muted)}`;

const TAGS = { pick: "PICK", skip: "SKIP", overrated: "OVERRATED FAV", value: "VALUE" };

function when(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short" }) + " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default {
  id: "football",
  title: "Football picks",
  size: "m",

  async render(el, ctx) {
    el.innerHTML = `<style>${css}</style><div class="fb"><div class="muted small">Loading…</div></div>`;
    const box = el.querySelector(".fb");

    ctx.every(15 * 60000, async () => {
      let d;
      try {
        const r = await fetch("/dashboard/football/picks.json?t=" + Date.now(), { credentials: "same-origin" });
        if (!r.ok) throw new Error("Couldn't load picks (" + r.status + ")");
        d = await r.json();
      } catch (e) { box.innerHTML = `<div class="muted small">⚠️ ${esc(e.message)}</div>`; return; }

      const now = Date.now() - 2 * 3600e3; // keep a game visible until roughly full time
      const fixtures = (d.fixtures || []).filter((f) => new Date(f.kickoff).getTime() > now);
      const picks = (d.picks || []).map((p) => `
        <div class="pick"><span><b>${esc(p.label)}</b>${p.type ? `<span class="tag ${esc(p.type)}">${TAGS[p.type] || ""}</span>` : ""}
          ${p.note ? `<span class="n">${esc(p.note)}</span>` : ""}</span>
          <span class="p">${pct(p.prob)}</span></div>`).join("");

      box.innerHTML = `
        ${picks ? `<div><h4>Best picks</h4><div style="display:grid;gap:5px">${picks}</div>
          ${d.acca ? `<div class="acca">Acca: ${d.acca.legs.map(esc).join(" + ")} · lands about ${pct(d.acca.prob)} of the time</div>` : ""}</div>` : ""}
        <div class="list"><h4>Fixtures</h4>
          ${fixtures.map((f) => `
            <div class="fx">
              <div class="top"><span>${esc(f.home)} v ${esc(f.away)}${f.tag ? `<span class="tag ${esc(f.tag)}">${TAGS[f.tag] || ""}</span>` : ""}</span>
                <span class="when">${when(f.kickoff)}</span></div>
              <div class="bar"><span class="h" style="width:${f.p[0]}%"></span><span class="d" style="width:${f.p[1]}%"></span><span class="a" style="width:${f.p[2]}%"></span></div>
              <div class="nums"><span>Home ${pct(f.p[0])}</span><span>Draw ${pct(f.p[1])}</span><span>Away ${pct(f.p[2])}</span></div>
              ${f.take ? `<div class="take">${esc(f.take)}</div>` : ""}
            </div>`).join("") || `<div class="muted small">No upcoming fixtures. New picks arrive Friday morning.</div>`}
        </div>
        <div class="foot">Updated ${new Date(d.updated).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · probabilities, not certainties — only stake what you can lose</div>`;
    });
  },
};

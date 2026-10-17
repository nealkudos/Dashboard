// Upcoming events from your calendars (Apple, Google, Kudos/Outlook) via their private iCal links.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["#2f6f5e", "#3b6fd4", "#c2572b", "#8a4fc7", "#c23b6b", "#b08a17", "#4f7f2a", "#6b6d72"];
const DAYS = 14;

const dayKey = (d) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtTime = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function dayLabel(key) {
  const today = dayKey(new Date());
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  if (key === today) return "Today";
  if (key === dayKey(tmr)) return "Tomorrow";
  return parseDay(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

export default {
  id: "calendar",
  title: "Upcoming",
  size: "m",

  async render(el, ctx) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;gap:8px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap" data-legend></div>
        <div data-list style="flex:1;overflow:auto;max-height:420px;margin:0 -4px;padding:0 4px"></div>
        <div data-foot class="muted small" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span data-status></span>
          <button class="link small" data-settings>Calendars</button>
        </div>
        <div data-panel hidden style="border-top:1px solid var(--line);padding-top:10px"></div>
      </div>`;
    const $ = (s) => el.querySelector(s);
    let sources = [];

    // ---------- Events ----------
    async function refresh() {
      $("[data-status]").textContent = "Updating…";
      let data;
      try { data = await ctx.api(`/api/calendar?days=${DAYS}`); }
      catch (e) { $("[data-status]").textContent = e.message; return; }
      draw(data);
      $("[data-status]").textContent = `Updated ${fmtTime(new Date())}`;
    }

    function draw(data) {
      const cals = Object.fromEntries(data.calendars.map((c) => [c.id, c]));
      $("[data-legend]").innerHTML = data.calendars.map((c) =>
        `<span class="small" style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:var(--surface-2)">
           <span style="width:8px;height:8px;border-radius:50%;background:${esc(c.color)}"></span>${esc(c.name)}</span>`).join("");

      const list = $("[data-list]");
      if (!data.calendars.length) {
        list.innerHTML = `<div class="muted small" style="padding:18px 0;text-align:center">No calendars connected yet.<br>Tap <b>Calendars</b> below to add one.</div>`;
        return;
      }

      const todayKey = dayKey(new Date());
      const now = Date.now();
      const groups = new Map();
      for (const ev of data.events) {
        let key, time, ongoing = false;
        if (ev.allDay) {
          key = ev.start < todayKey ? todayKey : ev.start;
          const endIncl = parseDay(ev.end); endIncl.setDate(endIncl.getDate() - 1);
          time = dayKey(endIncl) > key ? `Until ${endIncl.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}` : "All day";
        } else {
          const s = new Date(ev.start), e = new Date(ev.end);
          key = dayKey(s) < todayKey ? todayKey : dayKey(s);
          ongoing = s.getTime() <= now && e.getTime() > now;
          time = dayKey(s) < key ? `→ ${fmtTime(e)}` : (e > s ? `${fmtTime(s)}–${fmtTime(e)}` : fmtTime(s));
          if (e.getTime() < now) continue; // already finished today
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ ev, time, ongoing, color: cals[ev.cal]?.color || "#888", calName: cals[ev.cal]?.name || "" });
      }
      const keys = [...groups.keys()].sort();

      let html = keys.map((k) => `
        <div style="margin:10px 0 4px;font-size:12px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)">${esc(dayLabel(k))}</div>
        ${groups.get(k).map(({ ev, time, ongoing, color, calName }) => `
          <div title="${esc(calName)}" style="display:flex;gap:10px;align-items:flex-start;padding:7px 8px;border-radius:9px;${ongoing ? "background:color-mix(in srgb, var(--accent) 12%, transparent)" : ""}">
            <span style="flex:none;width:3px;align-self:stretch;border-radius:2px;background:${esc(color)}"></span>
            <span style="flex:none;width:92px;font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted);padding-top:1px">${esc(time)}</span>
            <span style="min-width:0">
              <div style="font-weight:550;overflow-wrap:anywhere">${esc(ev.title)}</div>
              ${ev.location ? `<div class="muted small" style="overflow-wrap:anywhere">${esc(ev.location)}</div>` : ""}
            </span>
          </div>`).join("")}`).join("");

      if (!keys.length) html = `<div class="muted small" style="padding:18px 0;text-align:center">Nothing in the next ${DAYS} days.</div>`;
      if (data.errors.length) {
        html = data.errors.map((e) => `<div class="small" style="color:var(--danger);margin:4px 0">${esc(e.name)}: ${esc(e.error)}</div>`).join("") + html;
      }
      list.innerHTML = html;
    }

    // ---------- Settings ----------
    async function openSettings() {
      const panel = $("[data-panel]");
      if (!panel.hidden) { panel.hidden = true; return; }
      panel.hidden = false;
      panel.innerHTML = `<div class="muted small">Loading…</div>`;
      sources = (await ctx.api("/api/calendar/sources")).sources;
      drawSettings();
    }

    function drawSettings(msg = "") {
      const panel = $("[data-panel]");
      const used = new Set(sources.map((s) => s.color));
      const nextColor = COLORS.find((c) => !used.has(c)) || COLORS[0];
      panel.innerHTML = `
        ${sources.map((s, i) => `
          <div style="display:flex;align-items:center;gap:8px;margin:6px 0">
            <input type="color" value="${esc(s.color)}" data-color="${i}" style="width:34px;height:30px;padding:2px;flex:none">
            <div style="flex:1;min-width:0">
              <div style="font-weight:550">${esc(s.name)}</div>
              <div class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.hint || "new")}</div>
            </div>
            <button class="link small" data-remove="${i}" style="color:var(--danger)">Remove</button>
          </div>`).join("") || `<div class="muted small">No calendars yet.</div>`}
        <form data-add style="display:grid;gap:6px;margin-top:10px">
          <div style="display:flex;gap:6px">
            <input type="color" name="color" value="${nextColor}" style="width:44px;padding:2px;flex:none">
            <input name="name" placeholder="Name, e.g. Kudos" maxlength="40" required style="padding:8px 10px;font-size:15px">
          </div>
          <input name="url" placeholder="Private calendar link (webcal:// or https://)" required style="padding:8px 10px;font-size:15px">
          <button style="padding:8px 12px">Add calendar</button>
        </form>
        <div class="small" data-msg style="margin-top:6px;color:var(--danger)">${esc(msg)}</div>
        <details class="small muted" style="margin-top:8px">
          <summary style="cursor:pointer">Where do I find the link?</summary>
          <p style="margin:6px 0"><b>Apple (iCloud):</b> Calendar app on iPhone → Calendars → ⓘ next to the calendar → turn on <i>Public Calendar</i> → Share Link → Copy.</p>
          <p style="margin:6px 0"><b>Google:</b> calendar.google.com on a computer → ⚙ Settings → click the calendar on the left → <i>Secret address in iCal format</i> → copy.</p>
          <p style="margin:6px 0"><b>Kudos (Outlook):</b> outlook.office.com → ⚙ Settings → Calendar → Shared calendars → <i>Publish a calendar</i> → pick the calendar, "Can view all details" → Publish → copy the <i>ICS</i> link.</p>
          <p style="margin:6px 0">These links are kept on your server and never shown in full again.</p>
        </details>`;

      panel.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () => save(sources.filter((_, i) => i !== +b.dataset.remove))));
      panel.querySelectorAll("[data-color]").forEach((inp) => (inp.onchange = () => {
        sources[+inp.dataset.color].color = inp.value; save(sources);
      }));
      panel.querySelector("[data-add]").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        save([...sources, { name: f.elements.name.value, color: f.elements.color.value, url: f.elements.url.value }]);
      };
    }

    async function save(list) {
      try {
        await ctx.api("/api/calendar/sources", {
          method: "PUT",
          body: { sources: list.map(({ id, name, color, url }) => ({ id, name, color, url })) },
        });
        sources = (await ctx.api("/api/calendar/sources")).sources;
        drawSettings();
        refresh();
      } catch (e) {
        drawSettings(e.message);
      }
    }

    $("[data-settings]").onclick = openSettings;
    ctx.every(10 * 60 * 1000, refresh);
  },
};

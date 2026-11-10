// The four "at a glance" cards across the top: money left, spending, what's next, the trading bot.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gbp = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gbp0 = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(Math.round(n)).toLocaleString("en-GB");

const ICONS = {
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4"/><rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M16 13.5h2"/>',
  bag: '<path d="M6 8h12l-1 11.5H7z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>',
};

function card(id, icon, tone, href) {
  const tag = href ? "a" : "div";
  return `<${tag} class="kpi tone-${tone}" id="kpi-${id}"${href ? ` href="${href}"` : ""}>
    <div class="kpi-top"><span class="kpi-ico"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></span><span class="pill" data-pill></span></div>
    <div class="kpi-val" data-val><span class="skel" style="width:60%"></span></div>
    <div class="kpi-lab" data-lab><span class="skel" style="width:40%"></span></div>
    <div class="kpi-sub" data-sub></div>
  </${tag}>`;
}

function set(id, { val, lab, sub, pill, pillTone }) {
  const el = document.getElementById(`kpi-${id}`);
  if (!el) return;
  el.querySelector("[data-val]").innerHTML = val;
  el.querySelector("[data-lab]").innerHTML = lab;
  el.querySelector("[data-sub]").innerHTML = sub || "";
  const p = el.querySelector("[data-pill]");
  p.innerHTML = pill || ""; p.className = `pill ${pillTone || ""}`; p.hidden = !pill;
}

export function startKpis(api) {
  const root = document.getElementById("kpis");
  root.innerHTML = card("left", "wallet", "blue", "/dashboard/budget/") + card("spent", "bag", "violet", "/dashboard/budget/")
    + card("next", "cal", "cyan") + card("bot", "bot", "green");
  root.querySelectorAll(".pill").forEach((p) => (p.hidden = true));

  // Money (one summary call + last month for comparison)
  (async () => {
    try {
      const d = await api("/api/budget/summary");
      const [y, m] = d.month.split("-").map(Number);
      const prev = new Date(y, m - 2, 1).toLocaleDateString("en-CA").slice(0, 7);
      const p = await api(`/api/budget/summary?month=${prev}`).catch(() => null);
      const daysLeft = Math.max(0, Math.round((Date.parse(d.period.end) - Date.parse(new Date().toLocaleDateString("en-CA"))) / 86400000));
      const t = d.totals;
      set("left", {
        val: `<span class="${t.left < 0 ? "neg" : ""}">${gbp(t.left)}</span>`,
        lab: "Left this month",
        sub: `${gbp0(t.income)} in · ${d.payday ? `payday in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : `${daysLeft} days to go`}`,
        pill: t.income ? `${Math.max(0, Math.round((t.left / t.income) * 100))}% left` : "", pillTone: t.left < 0 ? "bad" : "good",
      });
      let pill = "", tone = "";
      if (p && p.totals.spent > 0) {
        const pct = Math.round(((t.spent - p.totals.spent) / p.totals.spent) * 100);
        pill = `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`; tone = pct > 0 ? "bad" : "good";
      }
      const top = d.categories[0];
      set("spent", {
        val: gbp(t.spent), lab: "Spent this month",
        sub: [p ? `${gbp0(p.totals.spent)} last month` : "", top ? `most on ${esc(top.name)}` : ""].filter(Boolean).join(" · "),
        pill, pillTone: tone,
      });
    } catch (e) {
      set("left", { val: "–", lab: "Left this month", sub: esc(e.message) });
      set("spent", { val: "–", lab: "Spent this month" });
    }
  })();

  // Next calendar event
  (async () => {
    try {
      const d = await api("/api/calendar?days=14");
      const now = Date.now();
      const ev = (d.events || []).find((e) => !e.allDay && Date.parse(e.end || e.start) > now) || (d.events || [])[0];
      if (!ev) return set("next", { val: "All clear", lab: "Next up", sub: "Nothing in the next two weeks" });
      const st = new Date(ev.start);
      const today = new Date().toDateString(), tmr = new Date(now + 86400000).toDateString();
      const day = st.toDateString() === today ? "Today" : st.toDateString() === tmr ? "Tomorrow" : st.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      const time = ev.allDay ? "All day" : st.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const cal = (d.calendars || []).find((c) => c.id === ev.cal);
      set("next", {
        val: `<span class="kpi-title">${esc(ev.title || "Busy")}</span>`, lab: `${day} · ${time}`,
        sub: esc(ev.location ? ev.location.split(",")[0] : cal?.name || ""),
        pill: cal ? esc(cal.name) : "", pillTone: "plain",
      });
    } catch { set("next", { val: "–", lab: "Next up", sub: "Calendar unavailable" }); }
  })();

  // Trading bot
  const bot = async () => {
    try {
      const h = (await api("/api/trading-health")).data;
      const word = { ok: "Running", warn: "Needs a look", down: "Down" }[h.overall] || h.overall;
      set("bot", {
        val: `<span class="dot ${h.overall}"></span>${esc(word)}`, lab: "Trading bot",
        sub: `${h.stats?.signals ?? 0} signal${h.stats?.signals === 1 ? "" : "s"} today · last ${h.last_signal ? esc(h.last_signal.ago) : "none yet"}`,
        pill: h.mode === "live" ? "LIVE" : "Dry run", pillTone: h.mode === "live" ? "bad" : "plain",
      });
    } catch { set("bot", { val: '<span class="dot down"></span>Offline', lab: "Trading bot", sub: "Not responding" }); }
  };
  bot(); setInterval(bot, 60000);
}

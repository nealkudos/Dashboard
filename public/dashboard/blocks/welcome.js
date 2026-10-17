// Greeting, live clock and date.
export default {
  id: "welcome",
  title: "Today",
  size: "m",

  render(el, ctx) {
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;height:100%;min-height:110px">
        <div>
          <div data-greet style="font-size:24px;font-weight:650;letter-spacing:-.01em"></div>
          <div data-date class="muted"></div>
        </div>
        <div data-time style="font-size:44px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1"></div>
      </div>`;
    const greet = el.querySelector("[data-greet]");
    const date = el.querySelector("[data-date]");
    const time = el.querySelector("[data-time]");

    ctx.every(1000, () => {
      const now = new Date();
      const h = now.getHours();
      greet.textContent = `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}, Neal`;
      date.textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      time.textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    });
  },
};

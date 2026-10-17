// Light / dark switch shared by every page. Load it in <head> (plain script, not a module) so the
// chosen theme applies before the page paints. Any button with class "theme-btn" toggles it.
// First visit follows the phone's setting; after that the choice is remembered on this device.
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) {}
  var sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var current = saved === "light" || saved === "dark" ? saved : (sysDark ? "dark" : "light");
  root.setAttribute("data-theme", current);

  function paint() {
    var t = root.getAttribute("data-theme");
    document.querySelectorAll(".theme-btn").forEach(function (b) {
      b.textContent = t === "dark" ? "☀️" : "🌙";
      b.title = t === "dark" ? "Switch to light mode" : "Switch to dark mode";
      b.setAttribute("aria-label", b.title);
    });
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.setAttribute("content", t === "dark" ? "#111214" : "#f4f3ef");
      m.removeAttribute("media");
    });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".theme-btn");
    if (!b) return;
    var t = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch (err) {}
    paint();
  });
  document.addEventListener("DOMContentLoaded", paint);
})();

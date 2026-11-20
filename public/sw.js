// Service worker for the Home Screen app — only shows notifications (no caching, no fetch handling).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(m.title || "Neal's Dashboard", {
    body: m.body || "",
    tag: m.tag || undefined,
    icon: "/assets/icon-180.png",
    badge: "/assets/icon-180.png",
    data: { url: m.url || "/dashboard/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/dashboard/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("navigate" in w) { await w.navigate(url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(url);
  })());
});

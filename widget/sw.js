// The guide's doorbell: receives push messages and shows them as notifications,
// even when the app is closed. Kept tiny on purpose.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data.json();
  } catch {
    d = { body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "Ask Your Guide 🙏", {
      body: d.body || "",
      icon: "/icon-192.png?v=g3",
      badge: "/icon-192.png?v=g3",
      data: { url: d.url || "/", title: d.title || "", body: d.body || "" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  let url = d.url || "/";
  // opening the guide itself? carry the message in, so the conversation
  // starts FROM the notification (external links open as-is)
  if (url === "/" || url.startsWith(self.location.origin + "/?") || url === self.location.origin + "/") {
    const q = `n_t=${encodeURIComponent((d.title || "").slice(0, 80))}&n_b=${encodeURIComponent((d.body || "").slice(0, 200))}`;
    url = "/?" + q;
  }
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (ws) => {
      for (const w of ws) {
        if ("focus" in w && "navigate" in w) {
          await w.focus();
          return w.navigate(url).catch(() => {});
        }
      }
      return clients.openWindow(url);
    }),
  );
});

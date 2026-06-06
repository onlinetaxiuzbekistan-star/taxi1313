const CACHE_VERSION = 63;
const CACHE_NAME = "buxtaxi-driver-v" + CACHE_VERSION;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((c) => c.postMessage({ type: "sw_updated" })))
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
  if (event.data === "clearCaches") {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/ws")) return;
  if (url.pathname.includes("socket.io")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).then((response) => {
        return response;
      }).catch(() => {
        return new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuxTaxi</title></head><body style="background:#09090b;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h2>Нет подключения</h2><p style="color:#71717a">Проверьте интернет и попробуйте снова</p><button onclick="location.reload()" style="background:#F59E0B;color:#09090b;border:none;padding:14px 40px;border-radius:12px;font-size:16px;font-weight:600;margin-top:20px;cursor:pointer">Обновить</button></div></body></html>',
            { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        });
      })
    );
    return;
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "BuxTaxi", body: event.data.text() };
  }

  const notifType = payload.data?.type || "buxtaxi";

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/images/logo-icon.png",
    badge: payload.badge || "/images/logo-icon.png",
    vibrate: [300, 100, 300, 100, 400],
    tag: notifType === "new_message" ? `chat-${payload.data?.peerId || payload.data?.rideId || "general"}` : notifType,
    renotify: true,
    requireInteraction: notifType !== "new_message",
    data: payload.data || {},
    actions: [],
  };

  if (notifType === "new_order") {
    options.actions = [
      { action: "open", title: "Открыть" },
      { action: "dismiss", title: "Закрыть" },
    ];
    options.data.url = "/driver/incoming";
  } else if (notifType === "push_broadcast") {
    options.actions = [
      { action: "open", title: "Открыть" },
    ];
    options.tag = "push-" + (options.data.pushId || "latest");
    options.requireInteraction = true;
  } else if (notifType === "news") {
    options.actions = [
      { action: "open", title: "Читать" },
    ];
    options.data.url = "/driver/news";
    options.tag = "news-" + (options.data.newsId || "latest");
  } else if (notifType === "new_message") {
    options.actions = [
      { action: "reply", title: "Ответить" },
    ];
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "BuxTaxi", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const notifType = data.type || "";
  const targetUrl = data.url || "/driver";

  if (event.action === "dismiss") return;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/driver") && "focus" in client) {
          if (notifType === "new_order") {
            client.postMessage({ type: "navigate_incoming" });
          } else if (notifType === "news") {
            client.postMessage({ type: "navigate_news", newsId: data.newsId });
          } else if (notifType === "new_message") {
            client.postMessage({
              type: "open_chat",
              peerId: data.peerId ? Number(data.peerId) : null,
              rideId: data.rideId ? Number(data.rideId) : 0,
            });
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

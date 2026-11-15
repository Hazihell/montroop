const CACHE = "ki-shell-{build}";
const SHELL = ["/", "/app.js", "/style.css", "/favicon.svg", "/mark.svg", "/manifest.webmanifest", "/icon-192.png"];
const PAGES = ["/", "/settings", "/account", "/tree", "/new"];
const PAGE_WAIT = 3000;
// an agent's replies in its one notification, newest first (#178)
const SHOWN = 5;

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  const page = req.mode === "navigate" && (PAGES.includes(url.pathname) || /^\/a\/[a-z0-9]+(\/edit|\/s\/[A-Za-z]+)?$/.test(url.pathname));
  if (req.method !== "GET" || url.origin !== location.origin || !(page || SHELL.includes(url.pathname))) {
    return;
  }
  ev.respondWith(fresh(ev, req, page ? "/" : url.pathname));
});

// a page or shell file whose network hangs (a phone's, just woken) comes
// from the cache after PAGE_WAIT, and the cache is refreshed after (#159)
async function fresh(ev, req, key) {
  const cache = await caches.open(CACHE);
  const net = fetch(req.mode === "navigate" ? req.url : req, { cache: "no-cache" }).then(async (res) => {
    if (res.ok) {
      await cache.put(key, res.clone());
    }
    return res;
  });
  ev.waitUntil(net.catch(() => {}));
  try {
    const late = new Promise((ok) => setTimeout(ok, PAGE_WAIT, null));
    const res = (await Promise.race([net, late])) ?? (await cache.match(key)) ?? (await net);
    return res.status < 500 ? res : (await cache.match(key)) ?? res;
  } catch (err) {
    const kept = await cache.match(key);
    if (kept === undefined) {
      throw err;
    }
    return kept;
  }
}

// a reply of an agent: its name and chat; no picture, which Android would
// show on the right, not where a messaging app has it (#152), but Ki's mark
// in the status bar
self.addEventListener("push", (ev) => {
  let msg = {};
  try {
    msg = ev.data?.json() ?? {};
  } catch {}
  ev.waitUntil(notify(msg));
});

// every push shows: the server pushes none for a chat in view (#178)
async function notify(msg) {
  const url = typeof msg.url === "string" ? msg.url : "/";
  const tag = String(msg.tag ?? "ki");
  const had = (await self.registration.getNotifications({ tag })).flatMap((n) => n.body.split("\n"));
  const body = [String(msg.text ?? ""), ...had].slice(0, SHOWN).join("\n");
  await self.registration.showNotification(String(msg.title ?? "Ki"), { body, tag, renotify: true, badge: "/badge.png", data: { url } });
}

// the push service renewed the subscription: the server gets the new one
// (#152)
self.addEventListener("pushsubscriptionchange", (ev) => {
  ev.waitUntil((async () => {
    const options = ev.oldSubscription?.options;
    const sub = ev.newSubscription ?? (options === undefined ? null : await self.registration.pushManager.subscribe(options));
    if (sub !== null) {
      await fetch("/api/webpush", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    }
  })());
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  ev.waitUntil(open_chat(ev.notification.data?.url ?? "/"));
});

// an open app goes there itself, so its history stays one stack
async function open_chat(url) {
  const [tab] = await self.clients.matchAll({ type: "window" });
  if (tab === undefined) {
    return self.clients.openWindow(url);
  }
  await tab.focus();
  return tab.postMessage({ go: url });
}

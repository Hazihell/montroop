const CACHE = "ki-shell-{build}";
// the files a page needs to open offline, as the server names this build's
const SHELL = "{shell}".split(" ");
const PAGES = ["/", "/settings", "/tree", "/new", "/running", "/memory", "/team"];
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
  const page = req.mode === "navigate" && (PAGES.includes(url.pathname) || /^\/a\/[a-z0-9]+(\/edit|\/look|\/running|\/memory|\/tree|\/s\/[A-Za-z]+)?$/.test(url.pathname));
  if (req.method !== "GET" || url.origin !== location.origin || !(page || SHELL.includes(url.pathname))) {
    return;
  }
  ev.respondWith(kept(req, page ? "/" : url.pathname));
});

// a page or shell file comes from the cache at once, as it is this build's
// (#185): a new build is a new worker, which caches its own; one the cache
// lacks comes from the network, and is kept
async function kept(req, key) {
  const cache = await caches.open(CACHE);
  const had = await cache.match(key);
  if (had !== undefined) {
    return had;
  }
  const res = await fetch(req.mode === "navigate" ? req.url : req, { cache: "no-cache" });
  if (res.ok) {
    await cache.put(key, res.clone());
  }
  return res;
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

// every push shows: the server pushes none for a chat in view (#178).
// Pushes show one after another, each after the one before, failed or not:
// one that read an agent's notification while another was shown lost the
// other's line, even of another agent's
let showing = Promise.resolve();

function notify(msg) {
  showing = showing.catch(() => {}).then(() => show(msg));
  return showing;
}

// a push sent again (its first answer timed out) shows its line once
async function show(msg) {
  const url = typeof msg.url === "string" ? msg.url : "/";
  const tag = String(msg.tag ?? "ki");
  const text = String(msg.text ?? "");
  const had = (await self.registration.getNotifications({ tag })).flatMap((n) => n.body.split("\n")).filter((line) => line !== text);
  const body = [text, ...had].slice(0, SHOWN).join("\n");
  await self.registration.showNotification(String(msg.title ?? "Ki"), { body, tag, renotify: true, requireInteraction: tag.startsWith("ask-"), badge: "/badge.png?v=4", data: { url } });
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

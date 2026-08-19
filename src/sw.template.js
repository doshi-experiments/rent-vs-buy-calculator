// Offline shell for Rent vs Buy. Bumping VERSION invalidates the old cache.
const VERSION = "__BUILD__";
const CACHE = "rvb-" + VERSION;

const SHELL = [
  "./",
  "index.html",
  "app.js",
  "app.css",
  "manifest.webmanifest",
  "icon.svg",
  "favicon.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "fonts/IBMPlexSans-Regular.woff2",
  "fonts/IBMPlexSans-Medium.woff2",
  "fonts/IBMPlexSans-SemiBold.woff2",
  "fonts/IBMPlexMono-Regular.woff2",
  "fonts/IBMPlexMono-Medium.woff2",
  "fonts/IBMPlexMono-SemiBold.woff2",
  "fonts/IBMPlexSerif-Regular.woff2",
  "fonts/IBMPlexSerif-Medium.woff2",
  "fonts/IBMPlexSerif-SemiBold.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Any navigation (including /#p=1450000...) is served by the cached shell
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("index.html", { ignoreSearch: true }).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put("index.html", res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});

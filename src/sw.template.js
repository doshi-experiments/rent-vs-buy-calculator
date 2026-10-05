// Offline shell for Rent vs Buy. Bumping VERSION invalidates the old cache.
const VERSION = "__BUILD__";
const CACHE = "rvb-" + VERSION;

// Each tab is its own HTML file with its own title and canonical, so they
// are cached individually. build.sh substitutes the list from routes.json.
const ROUTES = __ROUTES__;

const SHELL = ROUTES.concat([
  "/app.js",
  "/app.css",
  "/fonts/commissioner-variable.woff2",
  "/design-system/prepaint.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
]);

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

  // Navigations are matched against their OWN path, never a single shared
  // shell: serving the cached "/" for /prepayment/ would hand that page the
  // home page's title and canonical. Network first so the metadata is
  // fresh, cache as the offline fallback, then "/" as a last resort.
  if (req.mode === "navigate") {
    const key = url.pathname.replace(/\/+$/, "") || "/";
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(key, { ignoreSearch: true })
            .then((hit) => hit || caches.match("/", { ignoreSearch: true }))
        )
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

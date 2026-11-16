/**
 * VERITAS Offline Service Worker (hand-written, zero external dependencies).
 * Precaches the app shell, core routes, HTML script/style assets, webpack lazy/worker
 * chunks (such as the OMR scanner worker), and the 9.9 MB OpenCV file so classroom
 * scanning works without Wi-Fi. Clerk, Convex, and non-GET requests stay network-only.
 */
const CACHE_NAME = "veritas-offline-v3";
const ROUTE_URLS = ["/", "/designer", "/scan", "/grade", "/admin"];
const PRECACHE_URLS = [
  ...ROUTE_URLS,
  "/icon.svg",
  "/manifest.webmanifest",
  "/vendor/opencv-4.10.0-release.1.js",
];

function extractStaticAssets(html) {
  const urls = new Set();
  const re = /\/_next\/static\/[^\s"'<>\\]+?\.(?:js|css|woff2)/g;
  let m;
  while ((m = re.exec(html)) !== null) urls.add(m[0]);
  return [...urls];
}

function extractWebpackChunks(js) {
  const urls = new Set();
  const names = new Map();
  // Next.js/webpack prefix overrides: ({84:"9b0008ae",524:"2170a4aa"})[e]||e
  const nameBlock = js.match(/\(\{([^}]+)\}\)\[[a-zA-Z]\]\|\|[a-zA-Z]/);
  if (nameBlock) {
    const nr = /(\d+):"([^"]+)"/g;
    let nm;
    while ((nm = nr.exec(nameBlock[1])) !== null) names.set(nm[1], nm[2]);
  }
  const hr = /(\d+):"([0-9a-f]{16})"/g;
  let hm;
  while ((hm = hr.exec(js)) !== null) {
    const id = hm[1];
    const hash = hm[2];
    const prefix = names.get(id) || id;
    urls.add(`/_next/static/chunks/${prefix}.${hash}.js`);
  }
  return [...urls];
}

async function precacheAll() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE_URLS.map((url) =>
      cache.add(url).catch(() => {
        /* ignore individual precache misses during install */
      }),
    ),
  );

  // Discover and precache all Next.js JS/CSS assets referenced by the 5 route HTML pages
  const staticUrls = new Set();
  for (const route of ROUTE_URLS) {
    try {
      const res = await cache.match(route);
      if (res) {
        const html = await res.text();
        for (const u of extractStaticAssets(html)) staticUrls.add(u);
      }
    } catch {
      /* ignore */
    }
  }
  await Promise.all(
    [...staticUrls].map((url) =>
      cache.add(url).catch(() => {
        /* ignore */
      }),
    ),
  );

  // Discover and precache lazy/worker chunks (e.g. omr-scanner.worker) from webpack runtime
  const extraChunks = new Set();
  for (const url of staticUrls) {
    if (!url.includes("/chunks/webpack-")) continue;
    try {
      const res = await cache.match(url);
      if (res) {
        const js = await res.text();
        for (const u of extractWebpackChunks(js)) extraChunks.add(u);
      }
    } catch {
      /* ignore */
    }
  }
  await Promise.all(
    [...extraChunks].map((url) =>
      cache.add(url).catch(() => {
        /* ignore CSS-only or unused chunk IDs */
      }),
    ),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAll());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("veritas-offline-") && k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Clerk, Convex, and external origins always stay network-only
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  // Immutable hashed assets & pinned OpenCV vendor file: cache-first
  if (url.pathname.startsWith("/vendor/") || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Page navigations, manifest, icon, and brand assets: network-first with cache fallback
  if (
    req.mode === "navigate" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/icon.svg" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/logos/")
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/"))),
    );
  }
});

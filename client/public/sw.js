/**
 * Service worker.
 *
 * Deliberately small. It caches the app shell so the interface opens instantly
 * and works offline, and it stays entirely out of the way of everything else.
 *
 * What is NOT cached, on purpose:
 *   - /api/*      album data is private and changes constantly; a stale gallery
 *                 or a cached 401 would be worse than a spinner
 *   - photos      originals and thumbnails are private media; leaving them to
 *                 the browser's own HTTP cache keeps them out of a store that
 *                 outlives the session
 *   - uploads     never intercepted, so a large POST is never buffered
 */
const VERSION = "v1";
const SHELL_CACHE = `memento-shell-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const SHELL_ASSETS = ["/", OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individual failures must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only; Cloudinary and fonts keep their normal HTTP caching.
  if (url.origin !== self.location.origin) return;

  // Private data and media are never served from the cache.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network first, falling back to the cached shell offline, so a
  // deep link still opens the app instead of the browser's error page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy)).catch(() => {});
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match("/")) ?? (await cache.match(OFFLINE_URL)) ?? Response.error();
        }),
    );
    return;
  }

  // Hashed build assets are immutable: serve from cache, populate on first use.
  if (url.pathname.startsWith("/assets/") || SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          }),
      ),
    );
  }
});

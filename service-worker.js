// ============================================================================
// Fruit Hockey — Service Worker (offline app shell)
// ----------------------------------------------------------------------------
// Precaches the app so it launches instantly and works fully offline. Bump
// CACHE_VERSION whenever assets change to invalidate the old cache.
// ============================================================================
const CACHE_VERSION = 'fruit-hockey-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/main.js',
  './js/ui.js',
  './js/game.js',
  './js/data.js',
  './js/storage.js',
  './js/audio.js',
  './js/ai.js',
  './js/matchmaking.js',
  './manifest.webmanifest',
  './assets/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS).catch(() => { /* tolerate missing optional files */ }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cache same-origin GETs as they are fetched.
        if (res && res.status === 200 && new URL(req.url).origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

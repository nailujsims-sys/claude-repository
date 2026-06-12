// Tombstone / kill-switch service worker.
//
// The previous app at this URL (Fruit Hockey) was a PWA whose service worker
// cached its app shell. Mind Whiteboard registers no service worker, but the
// old one stays installed in returning browsers and keeps serving the stale
// cached site. This script replaces it: when the browser picks up the update,
// it deletes all caches, unregisters itself, and reloads open tabs so they
// load the new app from the network. After that, nothing re-registers a SW.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      } catch {
        // ignore
      }
      try {
        await self.registration.unregister()
      } catch {
        // ignore
      }
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        try {
          client.navigate(client.url)
        } catch {
          // ignore
        }
      }
    })()
  )
})

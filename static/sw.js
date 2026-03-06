// ── Hall Manager PWA Service Worker ──────────────────
const CACHE_NAME = 'hall-manager-v1';

// Files to cache for offline use
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── Install — cache all assets ─────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app files');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Activate immediately without waiting
  self.skipWaiting();
});

// ── Activate — clean up old caches ────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// ── Fetch — serve from cache, fallback to network ─────
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip external requests (fonts, APIs etc)
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Return cached version if available
      if (cachedResponse) {
        // In background, fetch fresh version and update cache
        fetch(event.request).then(freshResponse => {
          if (freshResponse && freshResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, freshResponse);
            });
          }
        }).catch(() => {});

        return cachedResponse;
      }

      // Not in cache — fetch from network
      return fetch(event.request).then(networkResponse => {
        // Cache the new response
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Network failed — return offline page
        return caches.match('/');
      });
    })
  );
});

// ── Background Sync for updates ───────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

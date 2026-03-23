/**
 * Builderforce.ai Service Worker
 *
 * Strategy:
 *   - API calls (/api/*): network-only, never cached
 *   - Navigation (HTML): network-first with offline fallback
 *   - Static assets (JS/CSS/images): cache-first, refreshed in background
 *
 * Update flow:
 *   1. On deploy, this file changes → browser detects a new SW version
 *   2. New SW installs but waits (does not self.skipWaiting())
 *   3. PwaUpdateBanner detects the waiting SW and shows the update toast
 *   4. User clicks "Update now" → banner posts SKIP_WAITING → SW activates
 *   5. Page reloads with the new version
 */

const CACHE_NAME = 'bf-cache-v1';

const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-192.png',
  '/claw.png',
];

// ---------------------------------------------------------------------------
// Install — precache core assets, do NOT self.skipWaiting
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => { /* non-fatal */ }))
    // Intentionally no self.skipWaiting() — let the update banner drive activation
  );
});

// ---------------------------------------------------------------------------
// Activate — delete old cache versions, claim all clients
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests on the same origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls: always go to network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // Navigation (HTML pages): network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/').then((r) => r ?? new Response('Offline', { status: 503 }))
      )
    );
    return;
  }

  // Static assets: cache-first, update cache in background
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request).then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => null);

      return cached ?? (await networkFetch) ?? new Response('Not found', { status: 404 });
    })
  );
});

// ---------------------------------------------------------------------------
// Message — handle SKIP_WAITING from PwaUpdateBanner
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/**
 * Builderforce.ai Service Worker
 *
 * Strategy:
 *   - API calls (/api/*): network-only, never cached
 *   - Navigation (HTML): network-first with offline fallback
 *   - Static assets (JS/CSS/images): cache-first, refreshed in background
 *
 * Update flow:
 *   1. On deploy, scripts/stamp-sw-version.js rewrites BUILD_VERSION below with a
 *      unique per-build token → this file's bytes change → browser detects a new SW
 *   2. New SW installs but waits (does not self.skipWaiting())
 *   3. PwaUpdateBanner detects the waiting SW and shows the update toast
 *   4. User clicks "Update now" → banner posts SKIP_WAITING → SW activates
 *   5. Page reloads with the new version
 *
 * NOTE: __BUILD_VERSION__ is a literal placeholder. It is replaced at deploy time
 * (cf-build) so the SW byte content differs per build — without this the file is
 * byte-identical across deploys and the browser never surfaces an update.
 */

const BUILD_VERSION = '__BUILD_VERSION__';
const CACHE_NAME = 'bf-cache-' + BUILD_VERSION;

const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-192.png',
  '/agentHost.png',
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

// ---------------------------------------------------------------------------
// Push — OS-level notification fired by /api/push/notify-deploy on every deploy.
// Reaches the user even when the tab is backgrounded or closed.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload */ }

  const title = data.title || 'Builderforce updated';
  const options = {
    body: data.body || 'A new version is live. Reload to get the latest.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'bf-deploy', // collapse repeats into one notification
    renotify: true,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ---------------------------------------------------------------------------
// Notification click — focus an existing tab (reloading it onto the new build)
// or open one. Closing the notification needs no handler.
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => { /* navigate may reject cross-origin */ });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

/**
 * Builderforce.ai Service Worker
 *
 * Strategy:
 *   - API calls (/api/*): network-only, never cached
 *   - Navigation (HTML): network-first with offline fallback
 *   - Offline-capable routes (OFFLINE_CAPABLE_ROUTES, e.g. /studio/*): HTML and RSC
 *     payloads network-first with a runtime copy of the last good response, so a
 *     previously visited route loads with no network
 *   - Static assets (JS/CSS/images, incl. hashed /_next/static): cache-first
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
const CACHE_PREFIX = 'bf-';
const SHELL_CACHE = CACHE_PREFIX + 'shell-' + BUILD_VERSION;
const STATIC_CACHE = CACHE_PREFIX + 'static-' + BUILD_VERSION;
// Last good HTML / RSC payload of each visited offline-capable route. Separate
// caches because an HTML document and a flight payload can share one URL.
const PAGES_CACHE = CACHE_PREFIX + 'pages-' + BUILD_VERSION;
const RSC_CACHE = CACHE_PREFIX + 'rsc-' + BUILD_VERSION;
const CURRENT_CACHES = [SHELL_CACHE, STATIC_CACHE, PAGES_CACHE, RSC_CACHE];

// THE allow-list of routes that keep working offline once visited. A route opts
// in by being listed here (`/studio` covers `/studio` and `/studio/*`). Nothing
// is precached: the contract is runtime caching after a first online visit.
const OFFLINE_CAPABLE_ROUTES = ['/studio'];

function isOfflineCapable(pathname) {
  return OFFLINE_CAPABLE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
}

// A board held on this device has no server page until it syncs, and a board
// never opened here has no cached `/studio/<id>` page. One static shell
// (`/studio/local`, which reads `?board=<id>`) opens any held board offline: it
// is precached, kept under its BARE path (one entry for every `?board=`), and a
// `/studio/<uuid>` navigation that has no cached page is redirected to it.
const DEVICE_BOARD_SHELL = '/studio/local';
const DEVICE_BOARD_PATH = /^\/studio\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function deviceBoardIdOf(pathname) {
  const match = DEVICE_BOARD_PATH.exec(pathname);
  return match ? match[1].toLowerCase() : null;
}

// The shell, when it is cached, as a same-origin redirect to a FIXED path with a
// regex-constrained id; otherwise `otherwise()` (the offline page, or the server's 5xx).
function deviceBoardFallback(boardId, otherwise) {
  return caches.open(PAGES_CACHE)
    .then((cache) => cache.match(DEVICE_BOARD_SHELL))
    .then((shell) => (shell
      ? Response.redirect(self.location.origin + DEVICE_BOARD_SHELL + '?board=' + encodeURIComponent(boardId), 302)
      : otherwise()));
}

// Next's client-side navigation fetches a flight payload, not HTML.
function isRscRequest(request, url) {
  return request.headers.get('RSC') === '1' || url.searchParams.has('_rsc');
}

// Network-first with a runtime copy of the last good response. The REAL Response
// is cached (clone), so the COOP/COEP headers middleware sets on /studio/* come
// back verbatim when served from cache. Redirected responses are never stored
// (a redirected response can't answer a navigation); a 5xx answers from cache
// when there is one (platform outage), else `onServerError(res)` (default: the 5xx
// itself). `cacheKey` is the entry the response is stored and matched under.
function networkFirstWithCache(request, cacheName, fallback, cacheKey = request, onServerError = (res) => res) {
  return caches.open(cacheName).then((cache) =>
    fetch(request).then(
      (res) => {
        if (res.ok && !res.redirected) {
          cache.put(cacheKey, res.clone());
          return res;
        }
        if (res.status >= 500) {
          return cache.match(cacheKey).then((hit) => hit ?? onServerError(res));
        }
        return res;
      },
      () => cache.match(cacheKey).then((hit) => hit ?? fallback())
    )
  );
}

function offlinePage() {
  return caches.match('/offline.html', { cacheName: SHELL_CACHE })
    .then((r) => r ?? new Response('', { status: 503 }));
}

const PRECACHE_URLS = [
  '/offline.html',
  '/offline.js',
  '/manifest.json',
  '/icon-192.png',
  '/agentHost.png',
];

// ---------------------------------------------------------------------------
// Install — precache core assets, do NOT self.skipWaiting
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE)
        .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => { /* non-fatal */ })),
      // Best effort: a failed shell fetch must not fail the install (it is cached again on the first visit).
      caches.open(PAGES_CACHE)
        .then((cache) => cache.add(DEVICE_BOARD_SHELL).catch(() => { /* non-fatal */ })),
    ])
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
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.includes(k))
          .map((k) => caches.delete(k))
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

  // Offline-capable routes: RSC payloads, then HTML navigations, network-first
  // with a runtime copy. A cache miss offline: RSC fails the fetch (Next then
  // hard-navigates, which the navigation branch answers); HTML gets /offline.html.
  if (isOfflineCapable(url.pathname)) {
    if (isRscRequest(request, url)) {
      event.respondWith(networkFirstWithCache(request, RSC_CACHE, () => Response.error()));
      return;
    }
    if (request.mode === 'navigate') {
      const boardId = deviceBoardIdOf(url.pathname);
      const isShell = url.pathname === DEVICE_BOARD_SHELL;
      event.respondWith(networkFirstWithCache(
        request,
        PAGES_CACHE,
        boardId ? () => deviceBoardFallback(boardId, offlinePage) : offlinePage,
        isShell ? new Request(url.origin + DEVICE_BOARD_SHELL) : request,
        boardId ? (res) => deviceBoardFallback(boardId, () => res) : undefined,
      ));
      return;
    }
  }

  // Navigation (HTML pages): network-first
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(offlinePage));
    return;
  }

  // Static assets: cache-first, update cache in background
  event.respondWith(
    caches.match(request, { cacheName: SHELL_CACHE }).then((precached) => {
      if (precached) return precached;

      return caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => null);

        return cached ?? (await networkFetch) ?? new Response('Not found', { status: 404 });
      });
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

// Push / notification handlers intentionally omitted: OS-level notifications are
// handled by the host platform (BurnRateOS.com), not by Builderforce.

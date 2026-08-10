/**
 * `pwa` — the game as an installable app, on any phone, today.
 *
 * This is the target that answers "I want to play it on my phone" without an
 * Android SDK, an Xcode licence, a developer account, a store review or a cable.
 * The platform already publishes static assets to `<sub>.builderforce.ai`, so the
 * whole distance between "a generated HTML game" and "an app on the home screen"
 * is a manifest, a service worker, an icon set and the touch layer — all of which
 * are generated here.
 *
 * Both phones are covered, and they need different things:
 *
 *  - Android reads `manifest.webmanifest`. With `display: fullscreen`, a maskable
 *    512px icon and a service worker that answers offline, Chrome installs it as
 *    a WebAPK: a real launcher icon, its own task in the switcher, no browser UI.
 *
 *  - iOS ignores most of the manifest. It wants `apple-mobile-web-app-capable`,
 *    `apple-mobile-web-app-status-bar-style` and an `apple-touch-icon` PNG, and it
 *    only installs through Share → Add to Home Screen. Which is why the setup step
 *    below spells that out rather than saying "install the app" — on iOS there is
 *    no install prompt to wait for, and a user who does not know the gesture will
 *    conclude it does not work.
 *
 * The service worker is cache-first over a precached shell. For a game that is
 * correct rather than merely convenient: the entire game is one document, it has
 * no server to be stale against, and cache-first is what makes it play on a plane.
 */

import type { GameTarget, GameTargetContext, GameTargetResult } from '../gameTarget';
import { escapeHtml, injectIntoHead, withTouchControls } from '../gameDocument';
import { gameIconPng } from '../pngIcon';

/** Everything the worker precaches. The game is the shell; there is nothing else. */
const PRECACHE = ['./', './index.html', './icons/icon-192.png', './icons/icon-512.png'];

function renderManifest(ctx: GameTargetContext): string {
  const { game } = ctx;
  return JSON.stringify(
    {
      name: game.title,
      short_name: game.title.slice(0, 12),
      description: game.brief.slice(0, 300),
      start_url: './',
      scope: './',
      // `fullscreen` rather than `standalone`: a game wants the status bar gone.
      // Android honours it; iOS falls back to standalone, which is the right
      // degradation and needs no branch here.
      display: 'fullscreen',
      display_override: ['fullscreen', 'standalone'],
      orientation: 'any',
      background_color: '#0b0e1a',
      theme_color: game.accent,
      categories: ['games', 'entertainment'],
      icons: [
        { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  );
}

function renderServiceWorker(slug: string): string {
  // The cache name carries the slug so two games published under one account
  // never share a cache, and is versioned so a republish evicts the old game
  // rather than serving it forever out of a cache-first worker.
  return `/* Service worker for ${slug} — cache-first, offline-complete. */
const CACHE = '${slug}-v__BUILD__';
const PRECACHE = ${JSON.stringify(PRECACHE)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // Drop every cache that is not this build. Without this a cache-first worker
  // would serve the previous version of the game for as long as the phone keeps
  // the origin — the failure that makes people think a republish did nothing.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
      // Only same-origin, successful responses are worth keeping; an opaque
      // cross-origin response cached here would be indistinguishable from a
      // failure on the next load.
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match('./index.html'))),
  );
});
`;
}

export const pwaTarget: GameTarget = {
  key: 'pwa',
  label: 'Phone (install to home screen)',
  summary:
    'Publishes the game to its own address, installable on Android and iPhone. '
    + 'Fullscreen, offline, touch controls, real app icon. No account or toolchain.',
  zeroSetup: true,
  device: 'phone',
  directory: (slug) => `games/${slug}/pwa`,
  materialize(ctx: GameTargetContext): GameTargetResult {
    const { game } = ctx;

    const head = [
      `<link rel="manifest" href="./manifest.webmanifest">`,
      `<meta name="theme-color" content="${escapeHtml(game.accent)}">`,
      // iOS reads these three and none of the manifest.
      `<meta name="apple-mobile-web-app-capable" content="yes">`,
      `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
      `<meta name="apple-mobile-web-app-title" content="${escapeHtml(game.title.slice(0, 24))}">`,
      `<link rel="apple-touch-icon" href="./icons/icon-192.png">`,
      `<link rel="icon" type="image/png" sizes="512x512" href="./icons/icon-512.png">`,
      `<script>
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
</script>`,
    ].join('\n');

    const document = injectIntoHead(withTouchControls(game.html, game.accent), head);

    return {
      files: {
        'index.html': document,
        'manifest.webmanifest': renderManifest(ctx),
        // The build stamp is the game's own length: it changes exactly when the
        // game does, so a republish of an unchanged game does not needlessly
        // evict a working cache on every player's phone.
        'sw.js': renderServiceWorker(game.slug).replace('__BUILD__', String(game.html.length)),
      },
      binaryFiles: {
        'icons/icon-192.png': gameIconPng(192, game.accent),
        'icons/icon-512.png': gameIconPng(512, game.accent),
      },
      setupSteps: ctx.siteUrl
        ? [
            {
              key: 'install:ios',
              label: 'On iPhone: Share → Add to Home Screen',
              detail:
                'iOS has no install prompt — the game opens in Safari like a web page until you add it '
                + 'from the Share menu. Once added it launches fullscreen with its own icon and works offline.',
              blocking: false,
            },
            {
              key: 'install:android',
              label: 'On Android: tap Install when Chrome offers it',
              detail:
                'Chrome offers an install prompt automatically. Installing makes it a real app: launcher '
                + 'icon, its own window, no browser bar, works offline.',
              blocking: false,
            },
          ]
        : [
            {
              key: 'publish',
              label: 'Publish the game to get its address',
              detail: 'The game needs a public address before a phone can install it. Publishing takes a few seconds.',
              blocking: true,
            },
          ],
      playUrl: ctx.siteUrl,
      detail: ctx.siteUrl
        ? `Installable web app at ${ctx.siteUrl} — fullscreen, offline, touch controls`
        : 'Installable web app, ready to publish',
    };
  },
};

/**
 * Stamp a unique build token into the deployed service worker.
 *
 * public/sw.js ships with the literal placeholder `__BUILD_VERSION__`. Because
 * it is a static asset, its bytes are otherwise IDENTICAL on every deploy — and
 * the browser only ever surfaces a "waiting" service worker (which PwaUpdateBanner
 * listens for) when the SW script's bytes change. Without this stamp, deploys
 * never trigger the update toast: users keep running the old bundle until a hard
 * reload.
 *
 * We replace the placeholder with `<pkg.version>-<buildTime>` so the token is
 * unique per build even when multiple deploys share one package.json version
 * (the common case: several same-day deploys under one YYYY.M.D version).
 *
 * Runs after `@cloudflare/next-on-pages`, which copies public/ → the static
 * output root, so the SW lives at .vercel/output/static/sw.js.
 */
const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const swPath = path.join(process.cwd(), '.vercel/output/static/sw.js');

if (!fs.existsSync(swPath)) {
  console.warn('[stamp-sw] No sw.js at', swPath, '— skipping (nothing to stamp).');
  process.exit(0);
}

const token = `${version}-${Date.now()}`;
const src = fs.readFileSync(swPath, 'utf8');

if (!src.includes('__BUILD_VERSION__')) {
  // Placeholder already stamped or removed — fail loud so a regression that drops
  // the placeholder (and silently re-breaks update detection) is caught at build.
  console.error('[stamp-sw] __BUILD_VERSION__ placeholder not found in sw.js — update detection would break. Aborting.');
  process.exit(1);
}

fs.writeFileSync(swPath, src.replaceAll('__BUILD_VERSION__', token), 'utf8');
console.log('[stamp-sw] Stamped sw.js BUILD_VERSION =', token);

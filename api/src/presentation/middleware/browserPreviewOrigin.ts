/**
 * The preview origin for in-browser canvas previews (BuilderForce WebContainers,
 * relay mode).
 *
 * The canvas runs a project's dev server IN the user's browser and shows it in an
 * iframe. That code is AI-written and imports arbitrary npm packages, so it must
 * never run on builderforce.ai, where it could read the user's session. Instead it
 * is served from `preview.builderforce.ai`: the app frames this origin's
 * `relay.html` (hidden), which registers the preview service worker here, and the
 * preview iframe loads from here too. Both files come from the npm package, so
 * the worker and the app's runtime are always the same version.
 *
 * Static and cheap: three constant strings, no database, no auth. `relay.html` may
 * only be framed by the app itself (`frame-ancestors`), because whoever frames it
 * can drive it.
 */
import { processWorkerSource, relayHtml, serviceWorkerSource } from '@seanhogg/builderforce-webcontainers/assets';
import { PREVIEW_HOST } from '../../application/runtime/previewIngress';
import { appOrigins } from './cors';

/** Where the relay and worker live on the preview host (the worker's scope). */
export const BROWSER_PREVIEW_PREFIX = '/__bfwc/';

/** What the frontend passes as `relayUrl`. */
export const BROWSER_PREVIEW_RELAY_URL = `https://${PREVIEW_HOST}${BROWSER_PREVIEW_PREFIX}relay.html`;

/**
 * The app frames these from a cross-origin-isolated page (COEP), which refuses a
 * nested document that does not opt in itself.
 */
const EMBEDDABLE = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
};

/** What each file is and how long a cache may answer for it. */
interface PreviewAsset {
  body: string;
  contentType: string;
  cacheControl: string;
  /** Only `relay.html` is framed, so only it carries `frame-ancestors`. */
  framed?: boolean;
}

const ASSETS: Record<string, PreviewAsset> = {
  // Short: a deploy that changes the relay reaches open tabs on their next boot.
  'relay.html': { body: relayHtml, contentType: 'text/html; charset=utf-8', cacheControl: 'public, max-age=300', framed: true },
  // Browsers re-check a worker script on navigation; never let a cache answer for it.
  'sw.js': { body: serviceWorkerSource, contentType: 'text/javascript; charset=utf-8', cacheControl: 'no-cache' },
  // The process worker (node, npm, the shell). The relay starts it HERE, so a
  // project's code runs on this origin and never on builderforce.ai. Versioned by
  // the package, so a short cache is enough.
  'process-worker.js': { body: processWorkerSource, contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=300' },
};

export function serveBrowserPreviewOrigin(request: Request, corsOrigins: string | undefined): Response | null {
  const url = new URL(request.url);
  if (url.hostname !== PREVIEW_HOST || !url.pathname.startsWith(BROWSER_PREVIEW_PREFIX)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;

  const name = url.pathname.slice(BROWSER_PREVIEW_PREFIX.length);
  // Own keys only: `constructor` or `__proto__` must not resolve to Object's.
  if (!Object.hasOwn(ASSETS, name)) return null;
  const asset = ASSETS[name]!;
  return new Response(request.method === 'HEAD' ? null : asset.body, {
    headers: {
      ...EMBEDDABLE,
      'Content-Type': asset.contentType,
      'Cache-Control': asset.cacheControl,
      ...(asset.framed ? { 'Content-Security-Policy': `frame-ancestors ${appOrigins(corsOrigins).join(' ')}` } : {}),
    },
  });
}

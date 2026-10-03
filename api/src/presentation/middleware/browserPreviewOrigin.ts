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
 * Static and cheap: two constant strings, no database, no auth. `relay.html` may
 * only be framed by the app itself (`frame-ancestors`), because whoever frames it
 * can drive it.
 */
import { relayHtml, serviceWorkerSource } from '@seanhogg/builderforce-webcontainers/assets';
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

export function serveBrowserPreviewOrigin(request: Request, corsOrigins: string | undefined): Response | null {
  const url = new URL(request.url);
  if (url.hostname !== PREVIEW_HOST || !url.pathname.startsWith(BROWSER_PREVIEW_PREFIX)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;

  if (url.pathname === `${BROWSER_PREVIEW_PREFIX}relay.html`) {
    return new Response(request.method === 'HEAD' ? null : relayHtml, {
      headers: {
        ...EMBEDDABLE,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `frame-ancestors ${appOrigins(corsOrigins).join(' ')}`,
        // Short: a deploy that changes the relay reaches open tabs on their next boot.
        'Cache-Control': 'public, max-age=300',
      },
    });
  }
  if (url.pathname === `${BROWSER_PREVIEW_PREFIX}sw.js`) {
    return new Response(request.method === 'HEAD' ? null : serviceWorkerSource, {
      headers: {
        ...EMBEDDABLE,
        'Content-Type': 'text/javascript; charset=utf-8',
        // Browsers re-check a worker script on navigation; never let a cache answer for it.
        'Cache-Control': 'no-cache',
      },
    });
  }
  return null;
}

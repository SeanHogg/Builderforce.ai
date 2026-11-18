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
 * Static and cheap: constant strings, no database, no auth. `relay.html` may
 * only be framed by the app itself (`frame-ancestors`), because whoever frames it
 * can drive it.
 *
 * Every script carries an egress CSP (make.md §4 W10, control 6): the process Workers
 * run the app's code, so the browser — not anything inside them — decides which hosts
 * they may load from or connect to. The policies and their reasoning are in
 * `application/runtime/workerCsp`; a worker URL's signed `?policy=` id selects the app's
 * declared origins (`application/runtime/workerEgressPolicy`). The URL, query included,
 * is the cache key, so responses for different policies never share a cache entry.
 */
import {
  dotnetWorkerSource, phpWorkerSource, processWorkerSource, pythonWorkerSource, relayHtml, rustWorkerSource, serviceWorkerSource,
} from '@seanhogg/builderforce-webcontainers/assets';
import { PREVIEW_HOST } from '../../application/runtime/previewIngress';
import {
  PREVIEW_SCRIPT_PREFIX, REPORTING_ENDPOINTS_HEADER, relayCsp, serviceWorkerCsp, workerScriptCsp,
} from '../../application/runtime/workerCsp';
import {
  DEFAULT_WORKER_EGRESS_POLICY, resolveWorkerEgressPolicy, type WorkerEgressPolicy,
} from '../../application/runtime/workerEgressPolicy';
import { appOrigins } from './cors';

/** Where the relay and worker live on the preview host (the worker's scope). */
export const BROWSER_PREVIEW_PREFIX = PREVIEW_SCRIPT_PREFIX;

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

/** Which CSP a file gets. */
type CspKind = 'relay' | 'service-worker' | 'process-worker';

/** What each file is and how long a cache may answer for it. */
interface PreviewAsset {
  body: string;
  contentType: string;
  cacheControl: string;
  csp: CspKind;
}

const ASSETS: Record<string, PreviewAsset> = {
  // Short: a deploy that changes the relay reaches open tabs on their next boot.
  // Only the relay is framed, so only it carries `frame-ancestors`.
  'relay.html': { body: relayHtml, contentType: 'text/html; charset=utf-8', cacheControl: 'public, max-age=300', csp: 'relay' },
  // Browsers re-check a worker script on navigation; never let a cache answer for it.
  'sw.js': { body: serviceWorkerSource, contentType: 'text/javascript; charset=utf-8', cacheControl: 'no-cache', csp: 'service-worker' },
  // The process worker (node, npm, the shell). The relay starts it HERE, so a
  // project's code runs on this origin and never on builderforce.ai. Versioned by
  // the package, so a short cache is enough.
  'process-worker.js': { body: processWorkerSource, contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=300', csp: 'process-worker' },
  // Python (Pyodide) and PHP (php-wasm) processes, started by the relay beside the
  // Node ones. They import their interpreters from jsDelivr at run time, which the
  // worker CSP allows.
  'python-worker.js': { body: pythonWorkerSource, contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=300', csp: 'process-worker' },
  'php-worker.js': { body: phpWorkerSource, contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=300', csp: 'process-worker' },
  // .NET and Rust processes, started by the same relay: the same origin and the same
  // egress CSP as the other process Workers.
  'dotnet-worker.js': { body: dotnetWorkerSource, contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=300', csp: 'process-worker' },
  'rust-worker.js': { body: rustWorkerSource, contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=300', csp: 'process-worker' },
};

function cspFor(kind: CspKind, corsOrigins: string | undefined, policy: WorkerEgressPolicy): string {
  switch (kind) {
    case 'relay': return relayCsp(appOrigins(corsOrigins));
    case 'service-worker': return serviceWorkerCsp();
    case 'process-worker': return workerScriptCsp(policy.connectSources);
  }
}

/** Which asset a request names, or null when it is not one of ours. */
function previewAssetOf(request: Request): PreviewAsset | null {
  const url = new URL(request.url);
  if (url.hostname !== PREVIEW_HOST || !url.pathname.startsWith(BROWSER_PREVIEW_PREFIX)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const name = url.pathname.slice(BROWSER_PREVIEW_PREFIX.length);
  // Own keys only: `constructor` or `__proto__` must not resolve to Object's.
  return Object.hasOwn(ASSETS, name) ? ASSETS[name]! : null;
}

/**
 * Serve a preview-origin file under `policy` (the default, most restrictive one unless
 * the caller resolved a signed `?policy=`). Null when the request is not for one.
 */
export function serveBrowserPreviewOrigin(
  request: Request,
  corsOrigins: string | undefined,
  policy: WorkerEgressPolicy = DEFAULT_WORKER_EGRESS_POLICY,
): Response | null {
  const asset = previewAssetOf(request);
  if (!asset) return null;
  return new Response(request.method === 'HEAD' ? null : asset.body, {
    headers: {
      ...EMBEDDABLE,
      'Content-Type': asset.contentType,
      'Cache-Control': asset.cacheControl,
      'Content-Security-Policy': cspFor(asset.csp, corsOrigins, policy),
      'Reporting-Endpoints': REPORTING_ENDPOINTS_HEADER,
    },
  });
}

/**
 * The middleware entry: resolve a process worker's signed `?policy=` (a missing or
 * invalid one is the default), then serve. Null when the request is not for this origin.
 */
export async function handleBrowserPreviewOrigin(
  request: Request,
  corsOrigins: string | undefined,
  secret: string | undefined,
): Promise<Response | null> {
  const asset = previewAssetOf(request);
  if (!asset) return null;
  const policy = asset.csp === 'process-worker'
    ? await resolveWorkerEgressPolicy(secret, new URL(request.url).searchParams.get('policy'))
    : DEFAULT_WORKER_EGRESS_POLICY;
  return serveBrowserPreviewOrigin(request, corsOrigins, policy);
}

/**
 * The preview origins for in-browser canvas previews (BuilderForce WebContainers, relay
 * mode): `preview.builderforce.ai`, shared by the workspace, and — behind
 * `PREVIEW_PER_APP_ORIGINS` — one `<key>.preview.builderforce.ai` per application
 * (W10 control 1), `<key>` being the package's `previewOriginKey` (32 hex).
 *
 * The canvas runs a project's dev server IN the user's browser. That code is AI-written
 * and imports arbitrary npm packages, so it never runs on builderforce.ai, where it could
 * read the user's session: the app frames this origin's `relay.html` (hidden), which
 * registers the preview service worker here and starts the process Workers here. The
 * files come from the npm package, so worker and runtime are always the same version.
 *
 * Thin by design: this file routes; which headers each response gets, and whether `sw.js`
 * may be served, is `application/runtime/previewOriginHeaders` (README › "Preview origin
 * headers"). On a preview host:
 * - `/__bfwc/relay.html`, `sw.js` and the five process Worker scripts get their own sets;
 *   `sw.js` and the Workers resolve their signed `?policy=` against THIS host
 *   (`resolveWorkerEgressPolicy(secret, policy, url.hostname)`). A `sw.js` whose policy or
 *   egress is not what that policy grants is refused (403).
 * - every other response — the .NET runtime bundle (`/dotnet/<version>/…`,
 *   `dotnetBundleRoute`; any method but GET/HEAD there is a 405, never passed on), a 404 — gets
 *   the preview document headers; the container-preview ingress on the shared host (another product
 *   whose dev servers load what they like) gets only `nosniff` and `Origin-Agent-Cluster`.
 * A script is registered as a service worker only as `sw.js` in relay mode: a page on the
 * shared host (an ingress dev server) can never register another script, or `sw.js` in a
 * mode that takes attaches from any page, over the relay's registration.
 * An app host serves nothing but these: anything else there is a 404, never the API.
 */
import type { MiddlewareHandler } from 'hono';
import {
  dotnetWorkerSource, phpWorkerSource, processWorkerSource, pythonWorkerSource, relayHtml, rustWorkerSource, serviceWorkerSource,
} from '@seanhogg/builderforce-webcontainers/assets';
import { PREVIEW_HOST } from '../../application/runtime/previewIngress';
import {
  INGRESS_HEADERS, cspReportUrls, previewDocumentHeaders, previewFrameAncestors, relayHeaders, serviceWorkerAllowed, serviceWorkerHeaders,
  serviceWorkerQueryOf, workerScriptHeaders, type HeaderSet,
} from '../../application/runtime/previewOriginHeaders';
import { PREVIEW_SCRIPT_PREFIX, PREVIEW_WORKER_SCRIPTS } from '../../application/runtime/workerCsp';
import { previewOriginKeyOf, resolveWorkerEgressPolicy } from '../../application/runtime/workerEgressPolicy';
import type { HonoEnv } from '../../env';
import { DOTNET_BUNDLE_PATH_PREFIX, dotnetBundleBucketOf, serveDotnetBundleFile, type DotnetBundleBucket } from './dotnetBundleRoute';

/** Where the relay and worker live on a preview host (the worker's scope). */
export const BROWSER_PREVIEW_PREFIX = PREVIEW_SCRIPT_PREFIX;

/** What the frontend passes as `relayUrl`. */
export const BROWSER_PREVIEW_RELAY_URL = `https://${PREVIEW_HOST}${BROWSER_PREVIEW_PREFIX}relay.html`;

type PreviewScript = (typeof PREVIEW_WORKER_SCRIPTS)[number];

/**
 * Each script the relay may start (`PREVIEW_WORKER_SCRIPTS`, the ONE list) and its source.
 * Keyed by that list's own type, so a script added there without a source here fails to
 * compile, and nothing is served that the relay may not start.
 */
const SCRIPT_SOURCES: Readonly<Record<PreviewScript, string>> = {
  'sw.js': serviceWorkerSource,
  'process-worker.js': processWorkerSource,
  'python-worker.js': pythonWorkerSource,
  'php-worker.js': phpWorkerSource,
  'dotnet-worker.js': dotnetWorkerSource,
  'rust-worker.js': rustWorkerSource,
};

export interface PreviewOriginOptions {
  corsOrigins: string | undefined;
  /** `ENVIRONMENT`: local dev origins may frame a preview only in a development environment. */
  environment?: string;
  /** `CSP_REPORT_HOSTS`: API hosts besides production whose CSP report endpoint a relay may name. */
  cspReportHosts?: string;
  /** Signs the worker egress policy ids. */
  secret: string | undefined;
  /** `PREVIEW_PER_APP_ORIGINS`: serve `<key>.preview.builderforce.ai` too. */
  perAppOrigins: boolean;
  /** Where the .NET runtime bundle is mirrored (the `CDN` binding); absent, a bundle path is a 404. */
  dotnetBundle?: DotnetBundleBucket;
}

/** What a preview-host request comes to. */
export type PreviewOriginOutcome =
  /** Answered here. */
  | { kind: 'response'; response: Response }
  /** The shared host's request is the rest of the worker's (the container ingress); put `headers` on its answer. */
  | { kind: 'pass'; headers: HeaderSet };

/** `PREVIEW_PER_APP_ORIGINS` on: off unless exactly `true` (the wildcard DNS and certificate must exist first). */
export function perAppPreviewOrigins(env: { PREVIEW_PER_APP_ORIGINS?: string }): boolean {
  return env.PREVIEW_PER_APP_ORIGINS === 'true';
}

/** Put `headers` on `target`. A CSP or `Reporting-Endpoints` already there is kept beside ours, never replaced. */
export function applyPreviewHeaders(target: Headers, headers: HeaderSet): void {
  for (const [name, value] of Object.entries(headers)) {
    const additive = name === 'Content-Security-Policy' || name === 'Reporting-Endpoints';
    const existing = additive ? target.get(name) : null;
    target.set(name, existing && existing !== value ? `${existing}, ${value}` : value);
  }
}

function respond(status: number, body: BodyInit | null, headers: HeaderSet): Response {
  return new Response(body, { status, headers });
}

/** The script a `/__bfwc/` path names, or null. Own keys only: `constructor` or `__proto__` never resolve. */
function scriptOf(pathname: string): PreviewScript | 'relay.html' | null {
  if (!pathname.startsWith(BROWSER_PREVIEW_PREFIX)) return null;
  const name = pathname.slice(BROWSER_PREVIEW_PREFIX.length);
  if (name === 'relay.html') return name;
  return Object.hasOwn(SCRIPT_SOURCES, name) ? (name as PreviewScript) : null;
}

/**
 * The path-scoped sources the .NET Worker loads its runtime bundle from: `/dotnet/` on its own
 * origin, and on the shared host (the runtime's `dotnet.bundleUrl` is one URL for every
 * application). Never a bare origin — that would let the Worker re-enter `/__bfwc/`.
 */
function dotnetBundleSources(host: string): string[] {
  return [...new Set([`https://${host}${DOTNET_BUNDLE_PATH_PREFIX}`, `https://${PREVIEW_HOST}${DOTNET_BUNDLE_PATH_PREFIX}`])];
}

async function serveScript(request: Request, url: URL, name: PreviewScript | 'relay.html', options: PreviewOriginOptions): Promise<Response> {
  const frameAncestors = previewFrameAncestors(options.corsOrigins, options.environment);
  const refused = () => respond(403, 'This preview configuration is not granted.', {
    ...previewDocumentHeaders(url.host, frameAncestors), 'Cache-Control': 'no-store',
  });
  // A service worker registration names its script in this header: only the relay's `sw.js` may be one.
  if (request.headers.has('Service-Worker') && name !== 'sw.js') return refused();
  const body = (source: string) => (request.method === 'HEAD' ? null : source);
  if (name === 'relay.html') return respond(200, body(relayHtml), relayHeaders(frameAncestors));
  const resolved = await resolveWorkerEgressPolicy(options.secret, url.searchParams.get('policy'), url.hostname);
  if (name === 'sw.js') {
    if (!serviceWorkerAllowed(serviceWorkerQueryOf(url), resolved, cspReportUrls(options.cspReportHosts))) return refused();
    return respond(200, body(SCRIPT_SOURCES['sw.js']), serviceWorkerHeaders());
  }
  const ownPaths = name === 'dotnet-worker.js' ? dotnetBundleSources(url.host) : [];
  return respond(200, body(SCRIPT_SOURCES[name]), workerScriptHeaders(resolved, ownPaths));
}

/**
 * Route a request on a preview host. Null when the host is not one (the rest of the worker
 * answers, untouched).
 */
export async function handleBrowserPreviewOrigin(request: Request, options: PreviewOriginOptions): Promise<PreviewOriginOutcome | null> {
  const url = new URL(request.url);
  const shared = url.hostname === PREVIEW_HOST;
  if (!shared && previewOriginKeyOf(url.hostname) === null) return null;
  const documentHeaders = previewDocumentHeaders(url.host, previewFrameAncestors(options.corsOrigins, options.environment));
  const notFound = (): PreviewOriginOutcome => ({ kind: 'response', response: respond(404, 'Not found.', documentHeaders) });
  // An app host with the flag off (its DNS does not exist yet): nothing is served there.
  if (!shared && !options.perAppOrigins) return notFound();

  const script = request.method === 'GET' || request.method === 'HEAD' ? scriptOf(url.pathname) : null;
  if (script) return { kind: 'response', response: await serveScript(request, url, script, options) };

  // Every `/dotnet/` request is answered here, never passed on: the .NET Worker may reach this
  // path on the shared host, so it must never reach the container ingress through it.
  if (url.pathname.startsWith(DOTNET_BUNDLE_PATH_PREFIX) && request.method !== 'GET' && request.method !== 'HEAD') {
    return { kind: 'response', response: respond(405, null, { ...documentHeaders, Allow: 'GET, HEAD' }) };
  }
  const bundle = await serveDotnetBundleFile(request, options.dotnetBundle);
  if (bundle) {
    return {
      kind: 'response',
      response: respond(bundle.status, bundle.body, {
        ...documentHeaders,
        'Content-Type': bundle.contentType,
        'Cache-Control': bundle.cacheControl,
        // Public, immutable bytes: an application's Worker on its own origin reads them from the shared host.
        'Access-Control-Allow-Origin': '*',
        ...(bundle.etag ? { ETag: bundle.etag } : {}),
        ...(bundle.contentLength !== undefined ? { 'Content-Length': String(bundle.contentLength) } : {}),
      }),
    };
  }
  return shared ? { kind: 'pass', headers: INGRESS_HEADERS } : notFound();
}

/** The middleware: preview hosts are answered (or, on the shared host, headed) here; every other host passes untouched. */
export const browserPreviewOrigin: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const outcome = await handleBrowserPreviewOrigin(c.req.raw, {
    corsOrigins: c.env.CORS_ORIGINS,
    environment: c.env.ENVIRONMENT,
    cspReportHosts: c.env.CSP_REPORT_HOSTS,
    secret: c.env.JWT_SECRET,
    perAppOrigins: perAppPreviewOrigins(c.env),
    dotnetBundle: dotnetBundleBucketOf(c.env as { CDN?: DotnetBundleBucket }),
  });
  if (!outcome) return next();
  if (outcome.kind === 'response') return outcome.response;
  await next();
  // A WebSocket upgrade carries no settable headers (and copying it would drop the socket).
  if (c.res.status === 101) return;
  // A mutable copy (a proxied response's headers are immutable), then ours on it.
  c.res = new Response(c.res.body, c.res);
  applyPreviewHeaders(c.res.headers, outcome.headers);
};

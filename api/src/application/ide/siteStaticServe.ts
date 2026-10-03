/**
 * The STATIC half of a published site: assets and pages straight from R2, counted.
 *
 * Split from `siteServer.ts` so the published-site Worker (`src/sitesWorker.ts`) can
 * serve the overwhelmingly common request — a visitor loading a page and its
 * assets — while importing only site lookup, R2, the traffic buffer and the badge.
 * Everything that needs the rest of the platform (the site's datastore and sign-in,
 * its server code, the entitlement-checked shop window, a page-view workflow) is
 * reported back as `dynamic`; that Worker hands it to the API, and the API's
 * `tryServeHostedSite` answers it from the same pieces exported here.
 */
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { contentTypeFor, isImmutableAsset, resolveSiteForHost, type SiteRecord } from './siteHosting';
import {
  flushTrafficDeltas,
  invalidateSiteTraffic,
  isPageView,
  sharedTrafficBuffer,
  utcDay,
  visitorHash,
  visitorSalt,
} from './siteTraffic';
import { buildDatabase } from '../../infrastructure/database/connection';
import { landingPageApplies } from './siteLandingRule';
import { withSiteBadge } from './siteAttribution';
import { hasEventTriggerListeners } from '../workflow/eventTriggerListeners';

/** Path prefix reserved for the site's datastore. A published site cannot use
 *  it for assets — enforced by checking it before R2 is consulted. */
export const SITE_API_PREFIX = '/__api/';

/** Path prefix a published site's own handlers answer on. Unlike
 *  {@link SITE_API_PREFIX} this is NOT reserved: a request here falls back to a
 *  real file when no handler claims the route, so a site that already ships a
 *  static `/api/config.json` keeps working. */
export const SITE_BACKEND_PREFIX = '/api/';

export type WaitUntil = (promise: Promise<unknown>) => void;
export type SitesEnv = Env & { UPLOADS?: R2Bucket };

/** Fired for a counted page view — the workflow `page-view` trigger, which only the
 *  API carries. The static path never passes one: it routes a site that HAS such a
 *  listener to the API instead (see {@link serveStaticSiteRequest}). */
export type OnPageView = (site: SiteRecord, path: string, day: string) => Promise<unknown>;

/**
 * Make a single-page app's entry document work when it is served for a nested
 * route.
 *
 * A Vite/CRA build emits `<script src="./assets/app.js">` (or `assets/app.js`).
 * Served at `/`, that resolves correctly. Served as the SPA fallback for
 * `/docs/getting-started`, the browser resolves it against `/docs/`, asks for
 * `/docs/assets/app.js`, gets a 404, and the visitor sees a blank page — the
 * deep-link failure that makes a published site look broken precisely when
 * someone shares an inner page.
 *
 * `<base href="/">` fixes every relative URL in the document at once, which is
 * why it is preferable to rewriting each `src`/`href`. A document that already
 * declares its own base is left untouched: the author has said what they mean.
 */
export function withRootBase(html: string): string {
  if (/<base\s/i.test(html)) return html;
  const tag = '<base href="/">';
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const htmlTag = /<html[^>]*>/i.exec(html);
  if (htmlTag) {
    return html.slice(0, htmlTag.index + htmlTag[0].length) + `<head>${tag}</head>` + html.slice(htmlTag.index + htmlTag[0].length);
  }
  return tag + html;
}

/** True when serving the entry document for this path would break relative URLs
 *  — i.e. the browser's base is not the site root. */
function needsRootBase(assetPath: string): boolean {
  return assetPath.replace(/^\/+/, '').includes('/');
}

/** Serve one asset of a published site from an already-resolved site record.
 *  `exactOnly` suppresses the SPA fallback — used on the backend prefix, where
 *  answering an unmatched `/api/…` with the app's HTML would hand a `fetch()` a
 *  document instead of an error. */
export async function serveAsset(
  env: SitesEnv,
  site: SiteRecord,
  assetPath: string,
  exactOnly = false,
): Promise<{ response: Response; bytes: number }> {
  if (!env.UPLOADS) {
    return { response: new Response('Storage not configured', { status: 503 }), bytes: 0 };
  }

  const rel = assetPath.replace(/^\/+/, '');
  const tryKeys: string[] = [];
  if (rel && rel !== '/') tryKeys.push(site.r2Prefix + rel);
  // Directory / client-route request → SPA entry document.
  const looksLikeFile = /\.[a-z0-9]+$/i.test(rel);
  const fallbackKey = site.r2Prefix + site.indexDocument;
  if (!looksLikeFile && !exactOnly) tryKeys.push(fallbackKey);

  for (const key of tryKeys) {
    const obj = await env.UPLOADS.get(key);
    if (!obj) continue;
    const servedPath = key.slice(site.r2Prefix.length);
    const headers = new Headers();
    headers.set('Content-Type', contentTypeFor(servedPath));
    // Build-hashed assets are immutable; everything else (incl. the entry doc)
    // gets a short TTL so a republish is picked up quickly.
    headers.set(
      'Cache-Control',
      isImmutableAsset(servedPath) ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
    );
    // Only the SPA FALLBACK is rewritten, and only for a nested path: a direct
    // request for an HTML file resolves its own relative URLs correctly and must
    // be served byte-for-byte.
    if (key === fallbackKey && key !== site.r2Prefix + rel && needsRootBase(rel)) {
      const body = withRootBase(await obj.text());
      return { response: new Response(body, { headers }), bytes: body.length };
    }
    return { response: new Response(obj.body, { headers }), bytes: obj.size ?? 0 };
  }
  if (exactOnly) return { response: new Response(null, { status: 404 }), bytes: 0 };

  const notFound = await env.UPLOADS.get(site.r2Prefix + '404.html');
  if (notFound) {
    return {
      response: new Response(notFound.body, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      bytes: notFound.size ?? 0,
    };
  }
  return { response: new Response('Not found', { status: 404 }), bytes: 0 };
}

/**
 * Record one served request. Never awaited on the response path when a `waitUntil`
 * is available — the visitor gets their bytes whether or not the counter lands.
 */
export async function countSiteRequest(
  env: Env,
  site: SiteRecord,
  request: Request,
  path: string,
  bytes: number,
  options: {
    /** Override the path-derived classification. A backend call has no file
     *  extension, so it would otherwise be counted as a page view — and one page
     *  that calls three handlers on load would report four visits. */
    pageView?: boolean;
    onPageView?: OnPageView;
  } = {},
): Promise<void> {
  const day = utcDay(Date.now());
  const buffer = sharedTrafficBuffer();
  const pageView = options.pageView ?? isPageView(path);
  // Only page views need a visitor hash; hashing every asset fetch would triple
  // the crypto work on the hot path for no additional signal.
  // No salt (an un-provisioned Worker) → no hash: the view still counts, the visitor
  // just is not deduplicated — never an unsalted fingerprint of an IP address.
  const salt = pageView ? visitorSalt(env) : undefined;
  const visitor = salt
    ? await visitorHash(
        salt,
        request.headers.get('cf-connecting-ip') ?? undefined,
        request.headers.get('user-agent') ?? undefined,
        day,
      )
    : undefined;

  const shouldFlush = buffer.record({
    siteId: site.siteId,
    tenantId: site.tenantId,
    projectId: site.projectId,
    day,
    pageView,
    bytes,
    visitor,
  });

  // A `page-view` workflow trigger fires on the view itself, not on the batched
  // flush — a workflow that reacts to "somebody hit /pricing" is worthless if it
  // waits for the buffer to fill.
  if (pageView && options.onPageView) await options.onPageView(site, path, day).catch(() => undefined);

  if (!shouldFlush) return;

  const deltas = buffer.drain();
  try {
    await flushTrafficDeltas(buildDatabase(env), deltas);
    // The summary is read-through cached, so without this a user who just
    // shared their link would watch a stale zero for the whole TTL — exactly
    // the moment the number matters most. Only the projects in THIS batch.
    await Promise.all([...new Set(deltas.map((d) => d.projectId))]
      .map((projectId) => invalidateSiteTraffic(env, projectId)));
  } catch (error) {
    // Losing a batch of counters must never surface to a site visitor, and
    // re-queueing risks unbounded growth if the database is down. The metric is
    // explicitly approximate (see application/ide/siteTraffic.ts) — but a
    // PERSISTENTLY failing flush means the numbers are silently wrong, so it is
    // reported even though it is not raised.
    reportCaughtError(error, { source: 'application/ide/siteStaticServe.ts', operation: 'flushSiteTraffic' });
  }
}

/** Schedule `work` past the response when the runtime allows it, else await it. */
async function afterResponse(work: Promise<unknown>, waitUntil: WaitUntil | undefined): Promise<void> {
  if (waitUntil) waitUntil(work);
  else await work;
}

/** Serve the request's asset (SPA fallback included), count it, and badge it. The
 *  one exit shared by the static path and the API's fall-through. */
export async function serveCountedAsset(
  env: SitesEnv,
  site: SiteRecord,
  request: Request,
  path: string,
  waitUntil: WaitUntil | undefined,
  onPageView?: OnPageView,
): Promise<Response> {
  const { response, bytes } = await serveAsset(env, site, path.replace(/^\/+/, ''));
  await afterResponse(countSiteRequest(env, site, request, path, bytes, { onPageView }), waitUntil);
  return withSiteBadge(env, site.tenantId, response);
}

export type StaticSiteOutcome =
  /** The host is not a published site — a platform host, or unknown. */
  | { kind: 'not-a-site' }
  | { kind: 'served'; response: Response }
  /** A published site, but this request needs the full API. */
  | { kind: 'dynamic'; site: SiteRecord };

/**
 * Answer a request on a published site's host if it is purely static.
 *
 * `dynamic` for: the datastore (`/__api/`), the site's server code (`/api/`), the
 * landing-page fork (its entitlement check reads commerce state), and a page view on
 * a site whose tenant has a `page-view` workflow listening (firing it starts a run).
 * The listener check is cached, so a site with no such workflow pays nothing for it.
 */
export async function serveStaticSiteRequest(
  env: SitesEnv,
  request: Request,
  waitUntil?: WaitUntil,
): Promise<StaticSiteOutcome> {
  const site = await resolveSiteForHost(env, request.headers.get('host') ?? undefined);
  if (!site) return { kind: 'not-a-site' };

  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith(SITE_API_PREFIX) || path.startsWith(SITE_BACKEND_PREFIX)) return { kind: 'dynamic', site };
  if (landingPageApplies(site, url)) return { kind: 'dynamic', site };
  if (isPageView(path) && await hasEventTriggerListeners(env, buildDatabase(env), site.tenantId, 'page-view').catch(() => true)) {
    return { kind: 'dynamic', site };
  }

  return { kind: 'served', response: await serveCountedAsset(env, site, request, path, waitUntil) };
}

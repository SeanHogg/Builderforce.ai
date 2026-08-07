/**
 * Public surface of a published site — assets, its data API, and its counter.
 *
 * Serves built assets from R2 (`sites/<subdomain>/...`) with SPA fallback. No
 * auth — these are public websites. Three addressing modes now:
 *   - Host-based (production): `<sub>.builderforce.ai/<path>`, delivered by the
 *     worker's wildcard route.
 *   - Custom domain: a tenant's own hostname, once it is verified AND has a
 *     certificate (`application/ide/customDomain.ts`). Resolved through the same
 *     `resolveSiteForHost` as the platform label, so the two cannot serve
 *     different content.
 *   - Path-based (works without the wildcard route): `/api/sites/<sub>/<path>`.
 *
 * TWO THINGS THAT ARE NOT ASSET SERVING happen on this host:
 *   1. `POST /__api/collections/<name>` — the site's own backend. A form on a
 *      published page posts here. Reads are deliberately absent; see
 *      `application/ide/siteData.ts`.
 *   2. Traffic counting — every served request feeds the in-isolate buffer that
 *      flushes to `site_traffic_daily`. Done here rather than in a separate
 *      middleware so a request cannot be served without being counted.
 */
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  contentTypeFor,
  isImmutableAsset,
  lookupSite,
  resolveSiteForHost,
  type SiteRecord,
} from './siteHosting';
import { submitSiteRecord } from './siteData';
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

/** Path prefix reserved for the site's own backend. A published site cannot use
 *  it for assets — enforced by checking it before R2 is consulted. */
export const SITE_API_PREFIX = '/__api/';

type WaitUntil = (promise: Promise<unknown>) => void;

/** Serve one asset of a published site from an already-resolved site record. */
async function serveAsset(
  env: Env & { UPLOADS?: R2Bucket },
  site: SiteRecord,
  assetPath: string,
): Promise<{ response: Response; bytes: number }> {
  if (!env.UPLOADS) {
    return { response: new Response('Storage not configured', { status: 503 }), bytes: 0 };
  }

  const rel = assetPath.replace(/^\/+/, '');
  const tryKeys: string[] = [];
  if (rel && rel !== '/') tryKeys.push(site.r2Prefix + rel);
  // Directory / client-route request → SPA entry document.
  const looksLikeFile = /\.[a-z0-9]+$/i.test(rel);
  if (!looksLikeFile) tryKeys.push(site.r2Prefix + site.indexDocument);

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
    return { response: new Response(obj.body, { headers }), bytes: obj.size ?? 0 };
  }

  const notFound = await env.UPLOADS.get(site.r2Prefix + '404.html');
  if (notFound) {
    return {
      response: new Response(notFound.body, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      bytes: notFound.size ?? 0,
    };
  }
  return { response: new Response('Not found', { status: 404 }), bytes: 0 };
}

/** Serve one asset of a published site by subdomain + asset path. */
export async function serveHostedSite(
  env: Env & { UPLOADS?: R2Bucket },
  subdomain: string,
  assetPath: string,
): Promise<Response> {
  const site = await lookupSite(env, subdomain);
  if (!site) return new Response('Site not found', { status: 404 });
  const { response } = await serveAsset(env, site, assetPath);
  return response;
}

/**
 * Record one served request. Never awaited on the response path — the visitor
 * gets their bytes whether or not the counter lands.
 */
async function countRequest(
  env: Env,
  site: SiteRecord,
  request: Request,
  path: string,
  bytes: number,
): Promise<void> {
  const day = utcDay(Date.now());
  const buffer = sharedTrafficBuffer();
  const pageView = isPageView(path);
  // Only page views need a visitor hash; hashing every asset fetch would triple
  // the crypto work on the hot path for no additional signal.
  const visitor = pageView
    ? await visitorHash(
        visitorSalt(env),
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
    reportCaughtError(error, { source: 'application/ide/siteServer.ts', operation: 'flushSiteTraffic' });
  }
}

/** Handle a request to the site's own backend (`/__api/...`). */
async function handleSiteApi(
  env: Env,
  site: SiteRecord,
  request: Request,
  path: string,
): Promise<Response> {
  const rest = path.slice(SITE_API_PREFIX.length);
  const match = /^collections\/([a-z0-9-]{1,64})\/?$/i.exec(rest);
  if (!match) return jsonResponse({ error: 'Unknown endpoint.' }, 404);

  if (request.method === 'OPTIONS') {
    // A form posted from the site itself is same-origin, but a static export
    // hosted elsewhere is a legitimate caller too, so the write endpoint is
    // deliberately open — it can only ever CREATE a record in one collection.
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Use POST to submit.' }, 405);
  }

  const body = await readSubmission(request);
  if (body === null) return jsonResponse({ error: 'Could not read the submission.' }, 400);

  const ip = request.headers.get('cf-connecting-ip') ?? undefined;
  const day = utcDay(Date.now());
  const ipHash = ip ? await visitorHash(visitorSalt(env), ip, undefined, day) : null;

  const result = await submitSiteRecord({
    db: buildDatabase(env),
    siteId: site.siteId,
    tenantId: site.tenantId,
    collectionName: match[1]!,
    body,
    ipHash,
    userAgent: request.headers.get('user-agent'),
    referrer: request.headers.get('referer'),
  });

  if (!result.ok) return jsonResponse({ error: result.error }, result.status);
  return jsonResponse({ ok: true, id: result.recordId }, 201);
}

/** Accept both JSON and classic HTML form encodings, so a plain `<form>` with
 *  no JavaScript works exactly as well as a fetch(). */
async function readSubmission(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) return await request.json();
    if (type.includes('form')) {
      const form = await request.formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) out[k] = typeof v === 'string' ? v : (v as File).name;
      return out;
    }
    // No content-type (or an odd one) — try JSON, then give up.
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

/**
 * Host-based hosting hook for the top-level middleware. Returns a served
 * response when the request Host is a published site (platform subdomain OR a
 * verified custom domain), or null to let normal API routing continue.
 */
export async function tryServeHostedSite(
  env: Env & { UPLOADS?: R2Bucket },
  request: Request,
  waitUntil?: WaitUntil,
): Promise<Response | null> {
  const site = await resolveSiteForHost(env, request.headers.get('host') ?? undefined);
  if (!site) return null;

  const path = new URL(request.url).pathname;

  if (path.startsWith(SITE_API_PREFIX)) {
    const response = await handleSiteApi(env, site, request, path);
    // A submission is a page-level event; count it so form conversion shows up
    // in the same series as the views that produced it.
    const count = countRequest(env, site, request, path, 0);
    if (waitUntil) waitUntil(count);
    else await count;
    return response;
  }

  const { response, bytes } = await serveAsset(env, site, path.replace(/^\/+/, ''));
  const count = countRequest(env, site, request, path, bytes);
  if (waitUntil) waitUntil(count);
  else await count;
  return response;
}


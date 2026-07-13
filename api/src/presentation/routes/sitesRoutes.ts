/**
 * Public static hosting for published IDE (Designer) projects.
 *
 * Serves built assets from R2 (`sites/<subdomain>/...`) with SPA fallback. No
 * auth — these are public websites. Two addressing modes:
 *   - Host-based (production): `<sub>.builderforce.ai/<path>` — the worker's
 *     wildcard route delivers these; `serveHostedSite` is invoked by the
 *     host-hosting middleware in index.ts (see `tryServeHostedSite`).
 *   - Path-based (works without the wildcard route): `/api/sites/<sub>/<path>` —
 *     surfaced in the publish panel as "preview".
 *
 * The subdomain→site lookup goes through the read-through cache (hot path);
 * asset bytes stream from R2 with cache headers (immutable for build-hashed
 * files, short for the entry document).
 */
import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import {
  lookupSite,
  subdomainFromHost,
  contentTypeFor,
  isImmutableAsset,
} from '../../application/ide/siteHosting';

/** Serve one asset of a published site by subdomain + asset path. */
export async function serveHostedSite(
  env: Env & { UPLOADS?: R2Bucket },
  subdomain: string,
  assetPath: string,
): Promise<Response> {
  if (!env.UPLOADS) return new Response('Storage not configured', { status: 503 });

  const site = await lookupSite(env, subdomain);
  if (!site) return new Response('Site not found', { status: 404 });

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
      isImmutableAsset(servedPath)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=60',
    );
    return new Response(obj.body, { headers });
  }

  const notFound = await env.UPLOADS.get(site.r2Prefix + '404.html');
  if (notFound) {
    return new Response(notFound.body, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return new Response('Not found', { status: 404 });
}

/**
 * Host-based hosting hook for the top-level middleware. Returns a served
 * response when the request Host is a `<sub>.builderforce.ai` hosting
 * subdomain, or null to let normal API routing continue.
 */
export async function tryServeHostedSite(
  env: Env & { UPLOADS?: R2Bucket },
  host: string | undefined,
  path: string,
): Promise<Response | null> {
  const subdomain = subdomainFromHost(host);
  if (!subdomain) return null;
  return serveHostedSite(env, subdomain, path.replace(/^\/+/, ''));
}

/** Path-based router (`/api/sites/<sub>/...`) — works without the wildcard route. */
export function createSitesRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/:subdomain', (c) => serveHostedSite(c.env, c.req.param('subdomain'), ''));

  router.get('/:subdomain/*', (c) => {
    const sub = c.req.param('subdomain');
    const asset = c.req.path.replace(new RegExp(`^/api/sites/${sub}/`), '');
    return serveHostedSite(c.env, sub, asset);
  });

  return router;
}

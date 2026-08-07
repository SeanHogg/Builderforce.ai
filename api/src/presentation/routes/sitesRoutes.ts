/**
 * Path-based addressing for published sites (`/api/sites/<sub>/...`).
 *
 * The serving itself — assets, the site's `/__api/` backend, and traffic
 * counting — lives in `application/ide/siteServer.ts`, because it touches R2 and
 * the database and this is the presentation layer. This file is the thin router
 * for the path-based mode, which exists so the publish panel can offer a preview
 * link that works even where the wildcard route is not wired.
 *
 * Host-based serving (`<sub>.builderforce.ai` and verified custom domains) does
 * not come through here at all — it is handled by the top-level middleware in
 * index.ts calling `tryServeHostedSite` directly, before any router runs.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { serveHostedSite } from '../../application/ide/siteServer';

export { tryServeHostedSite } from '../../application/ide/siteServer';

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

/**
 * Owner-side control of a published site — `/api/projects/:projectId/site/*`.
 *
 * The public half of a site (assets, the `/__api/` write endpoint) is served on
 * the site's own host with no auth. Everything here is the opposite: the
 * tenant-authenticated surface for the three things that were missing after
 * "publish" — putting your own domain on it, reading what people submitted, and
 * seeing whether anyone came.
 *
 *   GET    /api/projects/:id/site/domain            current domain + DNS steps
 *   PUT    /api/projects/:id/site/domain            claim a hostname     (MANAGER+)
 *   POST   /api/projects/:id/site/domain/verify     check the TXT proof  (MANAGER+)
 *   DELETE /api/projects/:id/site/domain            disconnect           (MANAGER+)
 *   GET    /api/projects/:id/site/traffic           daily rollup
 *   GET    /api/projects/:id/site/collections       form endpoints
 *   POST   /api/projects/:id/site/collections       create one           (MANAGER+)
 *   PATCH  /api/projects/:id/site/collections/:cid  toggle / link        (MANAGER+)
 *   GET    /api/projects/:id/site/collections/:cid/records   submissions
 *
 * Reads are open to any tenant member (a site's traffic is not privileged);
 * every mutation is MANAGER+, matching the integrations surface.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../application/shared/dbPort';
import {
  claimCustomDomain,
  cnamePointsAtUs,
  getCustomDomain,
  releaseCustomDomain,
  verifyCustomDomain,
} from '../../application/ide/customDomain';
import { getSiteTraffic, siteForProject } from '../../application/ide/siteTraffic';
import {
  createCollection,
  listCollections,
  listRecords,
  updateCollection,
} from '../../application/ide/siteData';
import { HOSTING_APEX } from '../../application/ide/siteHosting';

export function createSiteManageRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const manager = requireRole(TenantRole.MANAGER);

  /** Every route is scoped to one project; parse + reject once. */
  const projectIdOf = (raw: string | undefined): number | null => {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  // ---- domain ----------------------------------------------------------

  router.get('/:projectId/site/domain', async (c) => {
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const result = await getCustomDomain(db, c.get('tenantId') as number, projectId);
    if (!result.ok) return c.json({ error: result.error }, result.status);

    // "Verified but still 404" is almost always a missing CNAME, and the
    // certificate state alone cannot say so. Only worth a DNS round-trip once
    // ownership is proven, so it is skipped while still pending.
    const pointed =
      result.state.hostname && result.state.status !== 'pending_dns'
        ? await cnamePointsAtUs(result.state.hostname)
        : null;
    return c.json({ ...result.state, apex: HOSTING_APEX, cnamePointsAtUs: pointed });
  });

  router.put('/:projectId/site/domain', manager, async (c) => {
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const body = await c.req.json<{ hostname?: string }>().catch(() => ({}) as never);
    const result = await claimCustomDomain(
      c.env,
      db,
      c.get('tenantId') as number,
      projectId,
      String(body.hostname ?? ''),
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.state);
  });

  router.post('/:projectId/site/domain/verify', manager, async (c) => {
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const result = await verifyCustomDomain(c.env, db, c.get('tenantId') as number, projectId);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.state);
  });

  router.delete('/:projectId/site/domain', manager, async (c) => {
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const result = await releaseCustomDomain(c.env, db, c.get('tenantId') as number, projectId);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.state);
  });

  // ---- traffic ---------------------------------------------------------

  router.get('/:projectId/site/traffic', async (c) => {
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const requested = Number(c.req.query('days') ?? '30');
    // The read model caches per window, so only the three the UI offers are
    // accepted — an arbitrary `days` would make the keyspace unbounded.
    const days = [7, 30, 90].includes(requested) ? requested : 30;
    const summary = await getSiteTraffic(c.env, db, c.get('tenantId') as number, projectId, days);
    return c.json(summary);
  });

  // ---- collections + records -------------------------------------------

  router.get('/:projectId/site/collections', async (c) => {
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const site = await siteForProject(db, tenantId, projectId);
    if (!site) return c.json({ error: 'This project has no published site yet.' }, 404);
    const collections = await listCollections(db, tenantId, site.siteId);
    const host = site.customDomain ?? `${site.subdomain}.${HOSTING_APEX}`;
    return c.json({
      collections: collections.map((col) => ({
        ...col,
        // The endpoint a form should post to — computed here so the UI never
        // has to reconstruct it (and get it wrong for a custom domain).
        endpoint: `https://${host}/__api/collections/${col.name}`,
      })),
    });
  });

  router.post('/:projectId/site/collections', manager, async (c) => {
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const site = await siteForProject(db, tenantId, projectId);
    if (!site) return c.json({ error: 'This project has no published site yet.' }, 404);
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as never);
    const result = await createCollection(db, tenantId, site.siteId, projectId, String(body.name ?? ''));
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.collection, 201);
  });

  router.patch('/:projectId/site/collections/:collectionId', manager, async (c) => {
    const collectionId = Number(c.req.param('collectionId'));
    if (!Number.isInteger(collectionId)) return c.json({ error: 'Invalid collection id.' }, 400);
    const body = await c.req.json<{
      acceptsPublicWrites?: boolean;
      audienceId?: number | null;
      dailyWriteCap?: number;
    }>().catch(() => ({}) as never);
    const result = await updateCollection(db, c.get('tenantId') as number, collectionId, body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.collection);
  });

  router.get('/:projectId/site/collections/:collectionId/records', async (c) => {
    const collectionId = Number(c.req.param('collectionId'));
    if (!Number.isInteger(collectionId)) return c.json({ error: 'Invalid collection id.' }, 400);
    const limit = Number(c.req.query('limit') ?? '50');
    const before = Number(c.req.query('before') ?? '0');
    const records = await listRecords(
      db,
      c.get('tenantId') as number,
      collectionId,
      limit,
      before > 0 ? before : undefined,
    );
    return c.json({ records });
  });

  return router;
}

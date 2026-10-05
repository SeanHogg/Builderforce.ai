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
 *   GET    /api/projects/:id/site/audience-summary  People: users, sign-ups, visitors, leads
 *   GET    /api/projects/:id/site/collections       form endpoints
 *   POST   /api/projects/:id/site/collections       create one           (MANAGER+)
 *   PATCH  /api/projects/:id/site/collections/:cid  toggle / link        (MANAGER+)
 *   DELETE /api/projects/:id/site/collections/:cid  remove + its records (MANAGER+)
 *   GET    /api/projects/:id/site/collections/:cid/records   submissions
 *   DELETE /api/projects/:id/site/collections/:cid/records/:rid  remove one (MANAGER+)
 *   GET    /api/projects/:id/site/users             the app's signed-up end users
 *   PATCH  /api/projects/:id/site/users/:uid        suspend / reinstate  (MANAGER+)
 *   DELETE /api/projects/:id/site/users/:uid        remove               (MANAGER+)
 *
 * Reads are open to any tenant member (a site's traffic is not privileged);
 * every mutation is MANAGER+, matching the integrations surface.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  claimCustomDomain,
  cnamePointsAtUs,
  getCustomDomain,
  releaseCustomDomain,
  verifyCustomDomain,
} from '../../application/ide/customDomain';
import { getSiteTraffic, siteForProject } from '../../application/ide/siteTraffic';
import { getSiteAudienceSummary, invalidateSiteAudience } from '../../application/ide/siteAudienceSummary';
import {
  createCollection,
  listCollections,
  listRecords,
  updateCollection,
} from '../../application/ide/siteData';
import { collectionInProject, deleteCollection, deleteRecord } from '../../application/ide/siteDataAdmin';
import { deleteSiteUser, listSiteUsers, setSiteUserStatus, SITE_USER_STATUSES } from '../../application/ide/siteUsersAdmin';
import { HOSTING_APEX } from '../../application/ide/siteHosting';
import { limitParam } from './queryParams';
import { parseBody, z } from './requestBody';

/** The domain service validates the hostname itself (its message names the fix). */
const ClaimDomainBody = z.object({ hostname: z.string().optional() });
/** Likewise `createCollection` owns the name rule. */
const CreateCollectionBody = z.object({ name: z.string().optional() });
const PatchCollectionBody = z.object({
  acceptsPublicWrites: z.boolean().optional(),
  audienceId: z.number().int().nullable().optional(),
  dailyWriteCap: z.number().optional(),
  raisesTickets: z.boolean().optional(),
  readPolicy: z.enum(['none', 'owner']).optional(),
});
const PatchSiteUserBody = z.object({ status: z.enum(SITE_USER_STATUSES) });

export function createSiteManageRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const manager = requireRole(TenantRole.MANAGER);

  /** Every id in these paths is a positive integer; parse + reject once. */
  const positiveId = (raw: string | undefined): number | null => {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  // ---- domain ----------------------------------------------------------

  router.get('/:projectId/site/domain', async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
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
    const projectId = positiveId(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const body = await parseBody(c, ClaimDomainBody);
    const result = await claimCustomDomain(
      c.env,
      db,
      c.get('tenantId') as number,
      projectId,
      body.hostname ?? '',
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.state);
  });

  router.post('/:projectId/site/domain/verify', manager, async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const result = await verifyCustomDomain(c.env, db, c.get('tenantId') as number, projectId);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.state);
  });

  router.delete('/:projectId/site/domain', manager, async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const result = await releaseCustomDomain(c.env, db, c.get('tenantId') as number, projectId);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.state);
  });

  // ---- traffic ---------------------------------------------------------

  router.get('/:projectId/site/traffic', async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const requested = Number(c.req.query('days') ?? '30');
    // The read model caches per window, so only the three the UI offers are
    // accepted — an arbitrary `days` would make the keyspace unbounded.
    const days = [7, 30, 90].includes(requested) ? requested : 30;
    const summary = await getSiteTraffic(c.env, db, c.get('tenantId') as number, projectId, days);
    return c.json(summary);
  });

  router.get('/:projectId/site/audience-summary', async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    // The use case clamps `days` to the windows the UI offers (bounded cache keyspace).
    const summary = await getSiteAudienceSummary(c.env, db, c.get('tenantId') as number, projectId, {
      days: Number(c.req.query('days') ?? '30'),
    });
    return c.json(summary);
  });

  // ---- collections + records -------------------------------------------

  const NO_SITE = 'This project has no published site yet.';
  const NOT_FOUND = 'Collection not found.';

  /** The project's site, or null — every collection and user route needs one. */
  const siteOf = (tenantId: number, projectId: number) => siteForProject(db, tenantId, projectId);

  router.get('/:projectId/site/collections', async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const site = await siteOf(tenantId, projectId);
    if (!site) return c.json({ error: NO_SITE }, 404);
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
    const projectId = positiveId(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const site = await siteOf(tenantId, projectId);
    if (!site) return c.json({ error: NO_SITE }, 404);
    const body = await parseBody(c, CreateCollectionBody);
    const result = await createCollection(db, tenantId, site.siteId, projectId, body.name ?? '');
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.collection, 201);
  });

  router.patch('/:projectId/site/collections/:collectionId', manager, async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    const collectionId = positiveId(c.req.param('collectionId'));
    if (!projectId || !collectionId) return c.json({ error: 'Invalid id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    if (!(await collectionInProject(db, tenantId, projectId, collectionId))) return c.json({ error: NOT_FOUND }, 404);
    const body = await parseBody(c, PatchCollectionBody);
    const result = await updateCollection(db, tenantId, collectionId, body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.collection);
  });

  router.delete('/:projectId/site/collections/:collectionId', manager, async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    const collectionId = positiveId(c.req.param('collectionId'));
    if (!projectId || !collectionId) return c.json({ error: 'Invalid id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const removed = await deleteCollection(db, tenantId, projectId, collectionId);
    if (!removed) return c.json({ error: NOT_FOUND }, 404);
    await invalidateSiteAudience(c.env, tenantId, projectId);
    return c.json({ ok: true });
  });

  router.get('/:projectId/site/collections/:collectionId/records', async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    const collectionId = positiveId(c.req.param('collectionId'));
    if (!projectId || !collectionId) return c.json({ error: 'Invalid id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    if (!(await collectionInProject(db, tenantId, projectId, collectionId))) return c.json({ error: NOT_FOUND }, 404);
    const limit = limitParam(c.req.query('limit'), 50, 200);
    const before = Number(c.req.query('before') ?? '0');
    const records = await listRecords(db, tenantId, collectionId, limit, before > 0 ? before : undefined);
    return c.json({ records });
  });

  router.delete('/:projectId/site/collections/:collectionId/records/:recordId', manager, async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    const collectionId = positiveId(c.req.param('collectionId'));
    const recordId = positiveId(c.req.param('recordId'));
    if (!projectId || !collectionId || !recordId) return c.json({ error: 'Invalid id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const removed = await deleteRecord(db, tenantId, projectId, collectionId, recordId);
    if (!removed) return c.json({ error: 'Record not found.' }, 404);
    await invalidateSiteAudience(c.env, tenantId, projectId);
    return c.json({ ok: true });
  });

  // ---- end users -------------------------------------------------------

  router.get('/:projectId/site/users', async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'Invalid project id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const site = await siteOf(tenantId, projectId);
    if (!site) return c.json({ error: NO_SITE }, 404);
    const limit = limitParam(c.req.query('limit'), 50, 200);
    const before = Number(c.req.query('before') ?? '0');
    const users = await listSiteUsers(db, tenantId, site.siteId, limit, before > 0 ? before : undefined);
    return c.json({ users });
  });

  router.patch('/:projectId/site/users/:userId', manager, async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    const userId = positiveId(c.req.param('userId'));
    if (!projectId || !userId) return c.json({ error: 'Invalid id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const site = await siteOf(tenantId, projectId);
    if (!site) return c.json({ error: NO_SITE }, 404);
    const body = await parseBody(c, PatchSiteUserBody);
    const user = await setSiteUserStatus(db, tenantId, site.siteId, userId, body.status);
    if (!user) return c.json({ error: 'User not found.' }, 404);
    return c.json(user);
  });

  router.delete('/:projectId/site/users/:userId', manager, async (c) => {
    const projectId = positiveId(c.req.param('projectId'));
    const userId = positiveId(c.req.param('userId'));
    if (!projectId || !userId) return c.json({ error: 'Invalid id.' }, 400);
    const tenantId = c.get('tenantId') as number;
    const site = await siteOf(tenantId, projectId);
    if (!site) return c.json({ error: NO_SITE }, 404);
    const removed = await deleteSiteUser(db, tenantId, site.siteId, userId);
    if (!removed) return c.json({ error: 'User not found.' }, 404);
    await invalidateSiteAudience(c.env, tenantId, projectId);
    return c.json({ ok: true });
  });

  return router;
}

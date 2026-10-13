/**
 * Insights SITES — `/api/replay/sites` (PRD 33 §4.2 steps 4–6, `REPLAY_PATHS.sites`,
 * `site`, `siteVerify`).
 *
 *   GET   /                  the workspace's sites           → ReplaySiteDto[]
 *   POST  /                  add an external site + bfr_ key → ReplaySiteDto (201)   MANAGER
 *   GET   /:siteId           one site                        → ReplaySiteDto
 *   PATCH /:siteId           label / settings / status / domains → ReplaySiteDto      MANAGER
 *   GET   /:siteId/verify    the live install checks         → ReplaySiteVerifyDto
 *
 * Every route: a workspace member (authMiddleware) of a workspace that holds Insights
 * (`requireFeature('sessionReplay')` — the capability licence, or a superadmin). A
 * site id outside the caller's workspace — or one that does not exist — is the same
 * 403 (D17); the application layer decides it.
 *
 * Its own router on the `/api/replay/sites` prefix, mounted BEFORE the data plane's
 * `/api/replay` router in `index.ts`, so the sites paths never meet that router's
 * `?site=` middleware. A presentation adapter only: no tables, no SQL.
 */
import { Hono, type Context } from 'hono';
import type { HonoEnv } from '../../env';
import type { DbHandle } from '../../application/shared/dbHandle';
import { TenantRole } from '../../domain/shared/types';
import { ForbiddenError } from '../../domain/shared/errors';
import { isReplaySiteId, type ReplayScope } from '../../domain/replay/replayScope';
import {
  createExternalSite,
  getSiteDto,
  listSiteDtos,
  siteVerify,
  updateSite,
} from '../../application/replay/replaySiteAdmin';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { refuseInsightsDuringEmulation } from '../middleware/insightsEmulationGuard';
import { requireFeature } from '../middleware/featureGate';
import { parseBody, z, zJsonObject } from './requestBody';

const CreateSiteBody = z.object({
  label: z.string(),
  allowedOrigins: z.array(z.string()),
  settings: zJsonObject.optional(),
});

const UpdateSiteBody = z.object({
  label: z.string().optional(),
  allowedOrigins: z.array(z.string()).optional(),
  settings: zJsonObject.optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

/** The caller's scope for `:siteId`; a malformed id is the same 403 as a foreign one. */
function scopeOf(c: Context<HonoEnv>): ReplayScope {
  const siteId = c.req.param('siteId');
  if (!isReplaySiteId(siteId)) throw new ForbiddenError('That Insights site is not in this workspace');
  return { tenantId: c.get('tenantId') as number, siteId };
}

export function createReplaySiteRoutes(db: DbHandle): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', async (c, next) => {
    refuseInsightsDuringEmulation(c); // D17: no superadmin data path
    const gate = await requireFeature(c, 'sessionReplay');
    if (gate) return gate;
    await next();
  });

  router.get('/', async (c) => c.json(await listSiteDtos(c.env, db, c.get('tenantId') as number)));

  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, CreateSiteBody);
    const site = await createExternalSite(db, c.env, {
      tenantId: c.get('tenantId') as number,
      userId: c.get('userId') as string,
      label: body.label,
      allowedOrigins: body.allowedOrigins,
      settings: body.settings,
    });
    return c.json(site, 201);
  });

  router.get('/:siteId', async (c) => c.json(await getSiteDto(c.env, db, scopeOf(c))));

  router.patch('/:siteId', requireRole(TenantRole.MANAGER), async (c) => {
    const scope = scopeOf(c);
    const body = await parseBody(c, UpdateSiteBody);
    return c.json(await updateSite(db, c.env, scope, body));
  });

  router.get('/:siteId/verify', async (c) => c.json(await siteVerify(c.env, db, scopeOf(c))));

  return router;
}

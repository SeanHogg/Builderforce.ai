/**
 * A project's hosted Insights site — `/api/projects/:projectId/replay/site`
 * (PRD 33 §4.2 step 5, S7; `REPLAY_PATHS.projectSite`).
 *
 *   GET   → the project's hosted site, or `null` when recording was never switched on
 *   POST  → switch recording on (idempotent: an existing site is returned, a disabled
 *           one re-enabled). MANAGER, like every other site write.
 *
 * Once resolved, the site is read like any other through `/api/replay/*?site=<id>`.
 * Gated like the sites routes: a member of a workspace holding Insights, and the
 * project must be the caller's workspace's (`projectInTenantCached`, the one
 * ownership gate `check:project-ownership` holds the codebase to). A presentation
 * adapter only.
 */
import { Hono, type Context } from 'hono';
import type { HonoEnv } from '../../env';
import type { DbHandle } from '../../application/shared/dbHandle';
import { TenantRole } from '../../domain/shared/types';
import { NotFoundError } from '../../domain/shared/errors';
import { projectInTenantCached } from '../../application/project/projectOwnership';
import { createHostedSite, projectSiteDto } from '../../application/replay/replaySiteAdmin';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/featureGate';

const SITE_PATH = '/:projectId/replay/site';

async function ownedProjectId(c: Context<HonoEnv>, db: DbHandle): Promise<number> {
  const raw = c.req.param('projectId') ?? '';
  const projectId = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(await projectInTenantCached(c.env, db, c.get('tenantId') as number, projectId))) {
    throw new NotFoundError('Project', raw);
  }
  return projectId;
}

export function createReplayProjectRoutes(db: DbHandle): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use(SITE_PATH, authMiddleware);
  router.use(SITE_PATH, async (c, next) => {
    const gate = await requireFeature(c, 'sessionReplay');
    if (gate) return gate;
    await next();
  });

  router.get(SITE_PATH, async (c) => {
    const projectId = await ownedProjectId(c, db);
    return c.json(await projectSiteDto(c.env, db, c.get('tenantId') as number, projectId));
  });

  router.post(SITE_PATH, requireRole(TenantRole.MANAGER), async (c) => {
    const projectId = await ownedProjectId(c, db);
    const site = await createHostedSite(db, c.env, {
      tenantId: c.get('tenantId') as number,
      projectId,
      userId: c.get('userId') as string,
    });
    return c.json(site, 201);
  });

  return router;
}

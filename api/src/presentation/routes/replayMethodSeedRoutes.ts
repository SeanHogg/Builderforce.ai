/**
 * Seed "The method" funnel — `/api/admin/replay-ops` (PRD 33 §5.3.6).
 *
 *   POST /sites/:siteId/seed-method-funnel   → ReplayMethodFunnelSeedDto (201 when it created
 *                                              anything, 200 on an idempotent re-run)
 *
 * Superadmin only (its own `superAdminMiddleware`), audited
 * (`REPLAY_METHOD_FUNNEL_SEEDED`). A sibling of `replayOpsGrantRoutes.ts` sharing the
 * prefix; a presentation adapter only.
 */
import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle } from '../../application/shared/dbHandle';
import { seedMethodFunnel } from '../../application/replay/replayMethodFunnel';
import { isReplaySiteId } from '../../domain/replay/replayScope';
import { ValidationError } from '../../domain/shared/errors';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';

export function createReplayMethodSeedRoutes(db: DbHandle): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('/sites/*', superAdminMiddleware);

  router.post('/sites/:siteId/seed-method-funnel', async (c) => {
    const siteId = c.req.param('siteId');
    if (!isReplaySiteId(siteId)) throw new ValidationError('siteId must be an Insights site id');
    const result = await seedMethodFunnel(db, c.env as Env, {
      siteId,
      actorId: c.get('userId') as string,
      ipAddress: c.req.header('cf-connecting-ip') ?? null,
    });
    return c.json(result, result.createdFunnel || result.createdSmartEvents.length > 0 ? 201 : 200);
  });

  return router;
}

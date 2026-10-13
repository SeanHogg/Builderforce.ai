/**
 * Insights OPERATIONS — `/api/admin/replay-ops` (PRD 33 D17, `REPLAY_PATHS.opsSummary`).
 *
 *   GET /summary   ReplayOpsSummaryDto — platform aggregates only
 *
 * The only Insights surface an operator has outside a workspace: counts, bytes and
 * pack revenue, never a site, visitor or recording. Superadmin-gated per route, so
 * this router shares its prefix with the grant router without wrapping its paths.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { requestDb } from '../../application/shared/dbHandle';
import { ReplayOpsService } from '../../application/replay/ReplayOpsService';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';

export function createReplayOpsRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/summary', superAdminMiddleware, async (c) => {
    return c.json(await new ReplayOpsService(c.env, requestDb(c)).summary());
  });

  return router;
}

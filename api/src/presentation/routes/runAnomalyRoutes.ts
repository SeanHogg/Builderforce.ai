/**
 * Run anomalies — /api/insights/run-anomalies
 *
 *   GET /run-anomalies?days=&projectId=   runs that cost, took or failed far outside
 *                                         their normal range, grouped by reason [manager]
 *
 * Mounted at the same `/api/insights` prefix as the sibling lenses. Same gate as the AI
 * Effectiveness lens it renders inside (manager + premium insights), because it reads the
 * same run-outcome ledger. The read, its key and its invalidation live in
 * `application/insights/runAnomalyInsights.ts`; this only parses the scope.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requirePlanFeature } from '../middleware/insightPlanGate';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getRunAnomalies } from '../../application/insights/runAnomalyInsights';
import { PREMIUM_INSIGHTS_FEATURE } from '../../application/insights/insightsExportSources';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { daysParam, positiveIntParam } from './queryParams';

export function createRunAnomalyRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/run-anomalies', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS_FEATURE), async (c) => {
    const { tenantId } = scope(c);
    const days = daysParam(c.req.query('days'), 30);
    const projectId = positiveIntParam(c.req.query('projectId'));
    return c.json(await getRunAnomalies(db, c.env as Env, tenantId, days, projectId));
  });

  return router;
}

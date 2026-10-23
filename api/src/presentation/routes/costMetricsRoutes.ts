/**
 * Cost metrics (LLM Cost Optimization · A4) — /api/cost
 *
 *   GET /metrics?window=7d|30d&groupBy=none|actionType|role|lever
 *       cache hit rate, median turns per completed run, median context tokens per turn,
 *       output/input ratio, reasoning share, cost per merged PR (per-run attribution),
 *       and — groupBy=lever — each lever's on-arm vs off-arm comparison   [manager]
 *   GET /runs/:executionId
 *       one run's per-turn breakdown: model, token split, cost, turn index, estimated
 *       tool-schema tokens and context categories                         [manager]
 *
 * Same gate as the sibling AI-effectiveness lenses (manager + premium insights): it reads
 * the same usage ledger and run-outcome ledger. Reads, keys and invalidation live in
 * `application/costMetrics/costMetricsService.ts`; this only parses the scope.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requirePlanFeature } from '../middleware/insightPlanGate';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { PREMIUM_INSIGHTS_FEATURE } from '../../application/insights/insightsExportSources';
import { getCostMetrics, getRunCostBreakdown } from '../../application/costMetrics/costMetricsService';
import { isCostMetricGroupBy, isCostMetricWindow } from '../../application/costMetrics/costMetricGroups';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { positiveIntParam } from './queryParams';

export function createCostMetricsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/metrics', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS_FEATURE), async (c) => {
    const { tenantId } = scope(c);
    const window = c.req.query('window') ?? '7d';
    const groupBy = c.req.query('groupBy') ?? 'none';
    if (!isCostMetricWindow(window)) return c.json({ error: 'window must be 7d or 30d' }, 400);
    if (!isCostMetricGroupBy(groupBy)) return c.json({ error: 'groupBy must be none, actionType, role or lever' }, 400);
    return c.json(await getCostMetrics(db, c.env as Env, tenantId, window, groupBy));
  });

  router.get('/runs/:executionId', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS_FEATURE), async (c) => {
    const { tenantId } = scope(c);
    const executionId = positiveIntParam(c.req.param('executionId'));
    if (executionId == null) return c.json({ error: 'executionId must be a positive integer' }, 400);
    return c.json(await getRunCostBreakdown(db, c.env as Env, tenantId, executionId));
  });

  return router;
}

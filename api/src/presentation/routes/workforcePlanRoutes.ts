/**
 * Workforce planning routes — /api/workforce/plan
 *
 * The blended human + agent capacity-vs-WIP allocation view (see
 * computeWorkforcePlan). MANAGER+ — it exposes cost rates + the hire-vs-agent
 * comparison, the same audience as the workforce metrics. Cached read-through on
 * the same version token the scorecards use (bumped on task-status + profile
 * writes) so a re-assignment or capacity edit refreshes it.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { computeWorkforcePlan } from '../../application/insights/workforcePlanning';
import { readWorkforceMetricsVersion } from '../../application/metrics/workforceMetrics';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createWorkforcePlanRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── GET /plan — blended workforce capacity plan (MANAGER+) ────────────────
  router.get('/plan', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const version = await readWorkforceMetricsVersion(env, tenantId);
    const key = `workforce-plan:tenant:${tenantId}:v:${version}`;
    const plan = await getOrSetCached(env, key, () => computeWorkforcePlan(db, tenantId), { kvTtlSeconds: 60, l1TtlMs: 15_000 });
    return c.json(plan);
  });

  return router;
}

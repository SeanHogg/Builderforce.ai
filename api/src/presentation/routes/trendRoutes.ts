/**
 * Trend Analysis lens — /api/insights/trend + /api/insights/trends
 *
 * Dedicated HTTP surface for PRD #208: "Are we accelerating, steady, or slowing?"
 *
 * Reuses:
 *   - computeTrend / computeTrendsForMetrics — the PURE+DB math already present
 *     in application/insights/trendAnalysis.ts (no new tables)
 *   - METRIC_REGISTRY — the whitelisted metric list that defines what can be trended
 *     (FR #1, AC2: dashboard visualises N predefined metrics)
 *   - metricRegistry.series — daily {day, value} series primitive (DAU, burn,
 *     deployment frequency, etc.)
 *
 * Acceptance mapped:
 *   AC1: GET /trend?metric=…&days=30 gives classification + slope + R² for a named metric.
 *   AC2: GET /trends?keys=…&days=… returns current status for N metrics with visual indicator
 *        labels (Accelerating/Steady/Slowing) + slope & r2.
 *   AC3/AC7: Alert integration lives in application/alerts/metricEvaluators.ts:
 *            trend transition thresholds (Steady→Slowing slope test) and the evaluator
 *            hook are modelled there so the existing runAlertSweep sweep covers them.
 *   AC4: Drill-down payload carries both `history` (resampled) and `rawHistory` (daily).
 *   AC5: METHOD disclosure payload is included in every response (method.id/name/description).
 *   AC6: granularity = daily|weekly|monthly handled via resampleSeries.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requirePlanFeature } from '../middleware/insightPlanGate';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { METRIC_REGISTRY } from '../../application/dashboards/metricRegistry';
import {
  computeTrend,
  computeTrendsForMetrics,
  explainMethod,
  type TrendGranularity,
} from '../../application/insights/trendAnalysis';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };
const PREMIUM_INSIGHTS = 'advancedInsights';

function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

function parseGranularity(raw: string | undefined): TrendGranularity {
  if (raw === 'weekly' || raw === 'monthly') return raw;
  return 'daily';
}

function parseTolerance(raw: string | undefined, def = 0.02): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return def;
  return n;
}

function listMetricKeys(): { key: string; label: string; hasSeries: boolean }[] {
  return Object.entries(METRIC_REGISTRY).map(([key, def]) => ({
    key,
    label: def.label,
    hasSeries: typeof def.series === 'function',
  }));
}

export function createTrendRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * GET /api/insights/trend/metrics — enumerate trended predefined metrics (AC2).
   * Returns the registry plus whether each metric has a daily series (so the
   * frontend can pre-filter).
   */
  router.get(
    '/trend/metrics',
    requireRole(TenantRole.MANAGER),
    requirePlanFeature(PREMIUM_INSIGHTS),
    (c) => {
      return c.json({
        metrics: listMetricKeys(),
        method: explainMethod(),
        labels: ['Accelerating', 'Steady', 'Slowing'] as const,
        granularities: ['daily', 'weekly', 'monthly'] as const,
      });
    },
  );

  /**
   * GET /api/insights/trend?metric=<key>&days=30[&granularity=daily][&tolerance=0.02]
   *
   * AC1, AC4, AC5, AC6:
   *   - classification (Accelerating/Steady/Slowing) + slope + R²
   *   - history + rawHistory (drill-down)
   *   - method disclosure
   *   - granularity handling
   */
  router.get('/trend', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const metric = c.req.query('metric');
    if (!metric) {
      return c.json({ error: 'metric query param is required — use /trend/metrics to enumerate' }, 400);
    }
    if (!METRIC_REGISTRY[metric]) {
      return c.json({ error: `unknown metric '${metric}'` }, 404);
    }

    const days = parseDays(c.req.query('days'));
    const granularity = parseGranularity(c.req.query('granularity'));
    const tolerance = parseTolerance(c.req.query('tolerance'));
    const env = c.env as Env;

    const cacheKey = `insights:trend:t:${tenantId}:m:${metric}:d:${days}:g:${granularity}:tol:${tolerance}`;
    try {
      const result = await getOrSetCached(
        env,
        cacheKey,
        () => computeTrend(db, tenantId, metric, days, granularity, tolerance),
        SHORT_TTL,
      );
      if (!result) {
        return c.json(
          {
            error: `metric '${metric}' has no daily series — trend requires a time-series source`,
            metric,
            method: explainMethod(),
          },
          400,
        );
      }
      return c.json(result);
    } catch (err: unknown) {
      return c.json({ error: (err as Error)?.message ?? String(err), metric }, 500);
    }
  });

  /**
   * GET /api/insights/trends?keys=<csv>&days=30[&granularity=daily]
   *
   * AC2: Dashboard rollup — current trend status for N predefined metrics.
   * Also powers the status-dot / color / icon surface of the dashboard:
   *   label  → icon/color mapping,
   *   slope  → slope arrow orientation,
   *   r2     → confidence visual.
   *
   * The aggregated response also surfaces the statistical method via the
   * `method` block so any client can disclose it in a tooltip (AC5).
   */
  router.get('/trends', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const rawKeys = c.req.query('keys') ?? c.req.query('metrics');
    const days = parseDays(c.req.query('days'));
    const granularity = parseGranularity(c.req.query('granularity'));
    const env = c.env as Env;

    // Default dashboard keys when none given: pick the first 6 series-capable metrics
    let keys: string[];
    if (rawKeys) {
      keys = rawKeys
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    } else {
      const cap = listMetricKeys().filter((m) => m.hasSeries).map((m) => m.key);
      keys = cap.slice(0, 6);
    }

    const cacheKey = `insights:trends:t:${tenantId}:k:${keys.slice().sort().join(',')}:d:${days}:g:${granularity}`;
    try {
      const data = await getOrSetCached(
        env,
        cacheKey,
        () => computeTrendsForMetrics(db, tenantId, keys, days, granularity),
        SHORT_TTL,
      );
      return c.json({
        windowDays: days,
        granularity,
        trends: data,
        method: explainMethod(),
      });
    } catch (err: unknown) {
      return c.json({ error: (err as Error)?.message ?? String(err) }, 500);
    }
  });

  return router;
}

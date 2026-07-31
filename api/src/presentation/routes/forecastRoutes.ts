/**
 * Forecasting / anomaly lens — /api/insights/forecast
 *
 * The forward-looking overlay on the existing rollups: for a chosen metric
 * (cost | cycle_time | cfr | throughput) it returns the observed history, a
 * least-squares projection, and the z-score anomalies — the "where is this
 * heading and what already looks wrong" companion to the point-in-time lenses.
 *
 *   GET    /forecast?metric=&days=     history + forecast + anomalies (manager, premium)
 *   POST   /forecast/ack               dismiss an anomaly point (manager)
 *   DELETE /forecast/ack?metric=&day=  restore a dismissed anomaly (manager)
 *
 * Manager-gated AND plan-gated (advancedInsights) — mirrors the premium exec
 * lenses. Cached on a short TTL over hot tables, with the ack version token folded
 * into the key so a dismiss refreshes the annotated anomalies immediately.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requirePlanFeature } from '../middleware/insightPlanGate';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { forecastAnomalyAcks } from '../../infrastructure/database/schema';
import { computeForecast, isForecastMetric } from '../../application/insights/forecastSeries';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Version token bumped on every ack write so annotated-anomaly reads refresh. */
function forecastAckVersionKey(tenantId: number): string {
  return `insights-forecast-ack:ver:tenant:${tenantId}`;
}

function parseDays(raw: string | undefined, def = 90): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

/** 'YYYY-MM-DD' validator for an anomaly point key. */
function isIsoDay(raw: string | undefined): raw is string {
  return !!raw && /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

const PREMIUM_FEATURE = 'advancedInsights';

export function createForecastRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/insights/forecast?metric=&days=
  router.get('/forecast', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_FEATURE), async (c) => {
    const { tenantId } = scope(c);
    const metric = c.req.query('metric');
    if (!isForecastMetric(metric)) {
      return c.json({ error: 'metric must be one of: cost, cycle_time, cfr, throughput' }, 400);
    }
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const now = Date.now();

    // Acked anomaly days for this metric (small set) — read outside the cache so
    // the annotation is fresh, but the token also keys the cache so it invalidates.
    const ver = await getCacheVersion(env, forecastAckVersionKey(tenantId));
    const key = `insights:forecast:t:${tenantId}:m:${metric}:d:${days}:v:${ver}`;
    const result = await getOrSetCached(env, key, async () => {
      const acks = await db
        .select({ pointDay: forecastAnomalyAcks.pointDay })
        .from(forecastAnomalyAcks)
        .where(and(eq(forecastAnomalyAcks.tenantId, tenantId), eq(forecastAnomalyAcks.metric, metric)));
      const ackedDays = new Set(acks.map((a) => a.pointDay));
      return computeForecast(db, tenantId, metric, days, now, ackedDays);
    }, SHORT_TTL);
    return c.json(result);
  });

  // POST /api/insights/forecast/ack  { metric, day, note? } — dismiss an anomaly.
  router.post('/forecast/ack', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_FEATURE), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = (c as unknown as { get(k: string): string | undefined }).get('userId') ?? null;
    const body = await c.req.json<{ metric?: string; day?: string; note?: string }>().catch(() => ({} as { metric?: string; day?: string; note?: string }));
    if (!isForecastMetric(body.metric) || !isIsoDay(body.day)) {
      return c.json({ error: 'metric (cost|cycle_time|cfr|throughput) and day (YYYY-MM-DD) are required' }, 400);
    }
    await db
      .insert(forecastAnomalyAcks)
      .values({ tenantId, segmentId: segmentId || null, metric: body.metric, pointDay: body.day, note: body.note?.slice(0, 500) ?? null, ackedBy: userId })
      .onConflictDoNothing();
    await bumpCacheVersion(c.env as Env, forecastAckVersionKey(tenantId));
    return c.json({ acknowledged: true, metric: body.metric, day: body.day }, 201);
  });

  // DELETE /api/insights/forecast/ack?metric=&day= — restore a dismissed anomaly.
  router.delete('/forecast/ack', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_FEATURE), async (c) => {
    const { tenantId } = scope(c);
    const metric = c.req.query('metric');
    const day = c.req.query('day');
    if (!isForecastMetric(metric) || !isIsoDay(day)) {
      return c.json({ error: 'metric and day are required' }, 400);
    }
    await db
      .delete(forecastAnomalyAcks)
      .where(and(eq(forecastAnomalyAcks.tenantId, tenantId), eq(forecastAnomalyAcks.metric, metric), eq(forecastAnomalyAcks.pointDay, day)));
    await bumpCacheVersion(c.env as Env, forecastAckVersionKey(tenantId));
    return c.json({ acknowledged: false, metric, day });
  });

  return router;
}

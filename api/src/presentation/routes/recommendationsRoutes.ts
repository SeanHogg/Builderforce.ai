/**
 * AI-driven Insights & Recommendations + SPACE metrics — /api/insights/*
 *
 * Two prescriptive surfaces that sit ON TOP of the existing read-only lenses:
 *
 *   GET  /recommendations         ranked prescriptive actions + anomalies [manager]
 *   POST /recommendations/dismiss { recKey } — hide an acknowledged rec      [manager]
 *   GET  /space                   SPACE five-dimension productivity scores  [developer]
 *
 * Mounted at '/api/insights' alongside createInsightsRoutes (Hono merges the two
 * routers under the same base). Recommendations/SPACE are recomputed live from the
 * already-cached collectors; only dismissals persist. Reads are short-TTL cached
 * (the inputs are hot-write) with a per-tenant dismissal version token folded into
 * the recommendations key so a dismissal refreshes the list immediately.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { computeRecommendations, dismissRecommendation } from '../../application/insights/recommendationsEngine';
import { computeSpaceMetrics } from '../../application/insights/spaceMetrics';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

function parseProjectId(raw: string | undefined): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Per-tenant version token bumped on every dismissal so the cached list ages out.
 *  Exported so the bundled /ai-overview read shares the exact same cache key (and
 *  thus honours dismissals) rather than re-deriving the recommendations. */
export function recsVersionKey(tenantId: number): string {
  return `insights-recs-version:tenant:${tenantId}`;
}

/** The recommendations read-through cache key for a tenant+window+dismissal token. */
export function recommendationsCacheKey(tenantId: number, days: number, ver: string): string {
  return `insights:recs:t:${tenantId}:d:${days}:v:${ver}`;
}

export function createRecommendationsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Prescriptive recommendations + anomalies (manager). Dismissal version folded
  // into the key so an ack refreshes the list immediately.
  router.get('/recommendations', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const ver = await getCacheVersion(env, recsVersionKey(tenantId));
    const key = recommendationsCacheKey(tenantId, days, ver);
    return c.json(await getOrSetCached(env, key, () => computeRecommendations(db, tenantId, days), SHORT_TTL));
  });

  // Dismiss (acknowledge) a recommendation by its stable rec_key (manager). Upserts
  // the dismissal then bumps the version token so the cached list drops it.
  router.post('/recommendations/dismiss', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const body = await c.req.json<{ recKey?: unknown }>().catch(() => ({} as { recKey?: unknown }));
    const recKey = typeof body.recKey === 'string' ? body.recKey.trim() : '';
    if (!recKey || recKey.length > 120) return c.json({ error: 'recKey is required' }, 400);
    const userId = (c.get('userId') as string | undefined) ?? null;
    await dismissRecommendation(db, tenantId, recKey, userId);
    await bumpCacheVersion(c.env as Env, recsVersionKey(tenantId));
    return c.json({ dismissed: recKey });
  });

  // SPACE metrics (developer+; complements DORA). Short TTL over hot tables.
  router.get('/space', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const projectId = parseProjectId(c.req.query('projectId'));
    const env = c.env as Env;
    const key = `insights:space:t:${tenantId}:d:${days}:p:${projectId ?? 0}`;
    return c.json(await getOrSetCached(env, key, () => computeSpaceMetrics(db, tenantId, days, projectId), SHORT_TTL));
  });

  return router;
}

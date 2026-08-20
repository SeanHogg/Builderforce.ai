/**
 * AI-driven Insights & Recommendations + SPACE metrics — /api/insights/*
 *
 * Two prescriptive surfaces that sit ON TOP of the existing read-only lenses:
 *
 *   GET  /recommendations          ranked prescriptive actions + anomalies [manager]
 *   POST /recommendations/dismiss  { recKey } — hide an acknowledged rec     [manager]
 *   GET  /space                    SPACE five-dimension productivity scores [developer]
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
import { getRecommendations, dismissRecommendationCached, getSpaceMetrics } from '../../application/insights/aiInsightsReads';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { positiveIntParam } from './queryParams';

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}


// The cache keys these reads use live in `application/insights/versionKeys.ts`
// beside every other insights token — a route is not the place two route modules
// go to agree on a key.

export function createRecommendationsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Prescriptive recommendations + anomalies (manager). Dismissal version folded
  // into the key so an ack refreshes the list immediately.
  router.get('/recommendations', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    return c.json(await getRecommendations(db, c.env as Env, tenantId, days));
  });

  // Dismiss (acknowledge) a recommendation by its stable rec_key (manager). Upserts
  // the dismissal then bumps the version token so the cached list drops it.
  router.post('/recommendations/dismiss', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const body = await c.req.json<{ recKey?: unknown }>().catch(() => ({} as { recKey?: unknown }));
    const recKey = typeof body.recKey === 'string' ? body.recKey.trim() : '';
    if (!recKey || recKey.length > 120) return c.json({ error: 'recKey is required' }, 400);
    const userId = (c.get('userId') as string | undefined) ?? null;
    await dismissRecommendationCached(db, c.env as Env, tenantId, recKey, userId);
    return c.json({ dismissed: recKey });
  });

  // SPACE metrics (developer+; complements DORA). Short TTL over hot tables.
  router.get('/space', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const projectId = positiveIntParam(c.req.query('projectId'));
    return c.json(await getSpaceMetrics(db, c.env as Env, tenantId, days, projectId));
  });

  return router;
}

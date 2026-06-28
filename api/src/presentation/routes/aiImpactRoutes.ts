/**
 * LENS — "AI Impact": /api/insights/ai-impact
 *
 * The marketed-but-unsurfaced trio (adoption trends, multi-tool evaluation,
 * AI productivity score) as a dedicated, manager-gated lens. Reads existing
 * collectors only (llm_usage_log + run_model_outcomes — no new collection).
 *
 * Mounted at the same `/api/insights` prefix as createInsightsRoutes (Hono
 * allows multiple routers at one prefix); kept separate so the orchestrator can
 * merge it without touching insightsRoutes.ts.
 *
 * Server-gated by role (manager) and cached on a short TTL because the inputs
 * are hot-write tables — a 60s KV / 15s L1 window keeps figures fresh without
 * version-bumping the metering path.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { computeAiImpact } from '../../application/insights/aiImpactInsights';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

export function createAiImpactRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // AI Impact — adoption trends + multi-tool evaluation + productivity score (manager)
  router.get('/ai-impact', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:aiimpact:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeAiImpact(db, tenantId, days), SHORT_TTL));
  });

  return router;
}

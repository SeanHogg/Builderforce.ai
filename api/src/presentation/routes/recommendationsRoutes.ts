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
import { createDecision, bulkCreateDecisions, getDecisionHistory, exportDecisionHistory } from '../../application/insights/recommendationDecisionService';
import { recsVersionKey } from './recommendationsRoutes';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

/** Validate decision type */
function validateDecision(decision: unknown): decision is 'accepted' | 'rejected' {
  return decision === 'accepted' || decision === 'rejected';
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

  // Accept or Reject a recommendation (decider)
  router.post('/recommendations/decision', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const body = await c.req.json<{ recKey: unknown; decision: unknown; rationale?: string }>()
      .catch(() => ({} as { recKey?: unknown; decision?: unknown; rationale?: unknown }));

    const recKey = typeof body.recKey === 'string' ? body.recKey.trim() : '';
    const decision = body.decision;
    const rationale = typeof body.rationale === 'string' ? body.rationale.trim() : undefined;

    if (!recKey) return c.json({ error: 'recKey is required' }, 400);
    if (recKey.length > 120) return c.json({ error: 'recKey too long (max 120 chars)' }, 400);
    if (!validateDecision(decision)) return c.json({ error: 'decision must be "accepted" or "rejected"' }, 400);

    const userId = (c.get('userId') as string | undefined) ?? null;

    await createDecision({
      recKey,
      decision: decision as 'accepted' | 'rejected',
      decidedBy: userId || 'system',
      rationale,
    });

    return c.json({ success: true, decision, recKey });
  });

  // Bulk accept/reject multiple recommendations
  router.post('/recommendations/decision/bulk', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const body = await c.req.json<{
      decisions: Array<{ recKey: string; decision: string; rationale?: string }>;
    }>().catch(() => ({}));

    if (!Array.isArray(body.decisions)) {
      return c.json({ error: 'decisions must be an array' }, 400);
    }

    const decisions = body.decisions
      .filter((d): d is { recKey: string; decision: 'accepted' | 'rejected'; rationale?: string } =>
        typeof d.recKey === 'string' && d.recKey.length > 0 && d.recKey.length <= 120 &&
        validateDecision(d.decision)
      )
      .map((d) => ({
        recKey: d.recKey,
        decision: d.decision,
        decidedBy: (c.get('userId') as string | undefined) ?? 'system',
        rationale: d.rationale || undefined,
      }));

    if (decisions.length === 0) return c.json({ error: 'no valid decisions provided' }, 400);

    const createdIds = await bulkCreateDecisions(decisions);
    return c.json({ success: true, count: createdIds.length, decision_ids: createdIds });
  });

  // Get decision history (admin only)
  router.get('/recommendations/decisions', requireRole(TenantRole.OWNER), async (c) => {
    const { tenantId } = scope(c);

    const status = c.req.query('status') as string | undefined;
    const limit = parseDays(c.req.query('limit') || '50', 50);
    const offset = parseDays(c.req.query('offset') || '0', 0);

    const decisions = await getDecisionHistory({
      tenantId,
      status,
      limit,
      offset,
    });

    return c.json({ decisions, total: decisions.length });
  });

  // Export decision history as CSV (admin only)
  router.get('/recommendations/decisions/export', requireRole(TenantRole.OWNER), async (c) => {
    const { tenantId } = scope(c);
    const startDate = c.req.query('start_date') || undefined;
    const endDate = c.req.query('end_date') || undefined;

    const csv = await exportDecisionHistory({
      tenantId,
      startDate,
      endDate,
    });

    return c.header('Content-Type', 'text/csv; charset=utf-8').text(csv);
  });

  // Get workflow execution status for a specific decision (admin only)
  router.get('/recommendations/workflows/:decisionId/status', requireRole(TenantRole.OWNER), async (c) => {
    const { tenantId } = scope(c);
    const decisionId = parseInt(c.req.param('decisionId') || '0');

    if (!Number.isFinite(decisionId)) {
      return c.json({ error: 'Invalid decisionId' }, 400);
    }

    const workflows = await getDecisionWorkflowExecutions(db, tenantId, decisionId);

    return c.json({ workflows, total: workflows.length });
  });

  // Retry failed workflow execution (decider or admin only)
  router.post('/recommendations/workflows/:executionId/retry', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const executionId = c.req.param('executionId');

    if (!executionId || typeof executionId !== 'string') {
      return c.json({ error: 'executionId is required' }, 400);
    }

    const userId = (c.get('userId') as string | undefined) ?? null;

    const result = await retryWorkflowExecution(db, tenantId, executionId, userId);

    if (result.success) {
      return c.json({ success: true, execution: result });
    } else {
      return c.json({ error: result.error }, 500);
    }
  });

  // Reopen a decision (decider or admin only)
  router.post('/recommendations/decisions/:decisionId/reopen', requireRole(TenantRole.OWNER), async (c) => {
    const { tenantId } = scope(c);
    const decisionId = parseInt(c.req.param('decisionId') || '0');
    const body = await c.req.json<{ rationale?: string }>().catch(() => ({}));

    if (!Number.isFinite(decisionId)) {
      return c.json({ error: 'Invalid decisionId' }, 400);
    }

    const userId = (c.get('userId') as string | undefined) ?? null;

    const result = await reopenDecision(db, tenantId, decisionId, userId, body.rationale);

    if (result.success) {
      return c.json({ success: true, decision: result });
    } else {
      return c.json({ error: result.error }, 500);
    }
  });

  // SPACE metrics (developer+; complements DORA). Short TTL over hot tables.
  router.get('/space', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:space:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeSpaceMetrics(db, tenantId, days), SHORT_TTL));
  });

  return router;
}

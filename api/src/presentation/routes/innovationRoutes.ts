/**
 * Innovation funnel — /api/innovation/*
 *
 * LENS #5 (gate insights.portfolio / CEO): the idea→validated→in_build→shipped→
 * measured pipeline + its conversion rollup. Idea CRUD rides the generic tracker
 * factory (manager-gated writes); the funnel rollup is cached under a version
 * token every idea write bumps, so conversion updates immediately.
 *
 *   GET   /funnel?initiative=<uuid?>   conversion metrics (scope = segment, or one initiative)
 *   …/ideas                            idea CRUD (generic tracker)
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { mountTrackers, scope } from './segmentTrackerRoutes';
import { getOrSetCached, getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { innovationIdeas } from '../../infrastructure/database/schema';
import { computeFunnel } from '../../application/insights/funnelInsights';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function funnelVersionKey(tenantId: number): string {
  return `innovation-funnel-version:tenant:${tenantId}`;
}

function parseInitiativeId(raw: string | undefined): string | undefined {
  return raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : undefined;
}

export function createInnovationRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/innovation/funnel?initiative=<uuid?>
  router.get('/funnel', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const initiativeId = parseInitiativeId(c.req.query('initiative'));
    const env = c.env as Env;
    const ver = await getCacheVersion(env, funnelVersionKey(tenantId));
    const key = `innovation:funnel:t:${tenantId}:s:${segmentId}:i:${initiativeId ?? 'all'}:v:${ver}`;
    const funnel = await getOrSetCached(
      env, key,
      () => computeFunnel(db, tenantId, segmentId, initiativeId, Date.now()),
      { kvTtlSeconds: 120, l1TtlMs: 30_000 },
    );
    return c.json(funnel);
  });

  // Idea CRUD (generic tracker; writes bump the funnel version token).
  mountTrackers(router, db, [
    {
      path: '/ideas',
      table: innovationIdeas,
      opts: {
        fields: ['initiativeId', 'title', 'description', 'stage', 'linkedProjectId', 'impact', 'effort', 'confidence', 'outcome', 'outcomeValue', 'killedReason', 'notes'],
        required: ['title'],
        bumpVersionKeys: (t) => [funnelVersionKey(t)],
      },
    },
  ]);

  return router;
}

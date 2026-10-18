/**
 * EMP feature lenses — additional routers mounted on /api/insights.
 *
 * Kept in one NEW module (mounted alongside the other insight lenses; Hono merges
 * routers on the shared prefix, each carrying its own authMiddleware) so the shared
 * insightsRoutes.ts is untouched:
 *
 *   GET    /benchmarking/cross-team   EMP-5  internal cross-team percentile   [manager, cached]
 *   GET    /delay-taxonomy            EMP-9  delay root-cause distribution     [manager, cached]
 *   POST   /delay-taxonomy            EMP-9  tag a task's delay reason         [developer]
 *   DELETE /delay-taxonomy/:taskId    EMP-9  clear a task's delay reason       [developer]
 *   GET    /export?dataset=&format=   EMP-20 dataset export (export source)    [manager]
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { delayReasons } from '../../infrastructure/database/schema';
import { computeCrossTeamBenchmark } from '../../application/insights/crossTeamBenchmark';
import { computeDelayTaxonomy, isDelayReason } from '../../application/insights/delayTaxonomy';
import { insightDatasetExportSource } from '../../application/insights/insightsExportSources';
import { exportSourceHandler } from './exportSourceRoute';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { positiveIntParam, daysParam } from './queryParams';
import { parseOptionalBody, z, zNumberLike } from './requestBody';

/** `POST /delay-taxonomy` — `isDelayReason` owns the reason vocabulary. */
const DelayReasonBody = z.object({
  taskId: zNumberLike.nullish(),
  reasonCode: z.string().optional(),
  notes: z.string().nullish(),
});

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };


/** Read a userId off the Hono context (set by authMiddleware) without a cast dance. */
function userIdOf(c: unknown): string | null {
  return (c as { get(k: string): string | undefined }).get('userId') ?? null;
}

export function createEmpFeatureRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // EMP-5 — internal cross-team benchmarking (manager, cached per tenant+window).
  router.get('/benchmarking/cross-team', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = daysParam(c.req.query('days'), 30);
    const projectId = positiveIntParam(c.req.query('projectId'));
    const env = c.env as Env;
    const key = `insights:xteam:t:${tenantId}:d:${days}:p:${projectId ?? 0}`;
    return c.json(await getOrSetCached(env, key, () => computeCrossTeamBenchmark(db, tenantId, days, projectId), SHORT_TTL));
  });

  // EMP-9 — delay root-cause distribution (manager, cached). Tag writes below bump
  // the cache indirectly by keying on a short TTL (the read is a rollup over hot
  // transition + tag tables; the short TTL keeps it fresh without a version token).
  router.get('/delay-taxonomy', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = daysParam(c.req.query('days'), 90);
    const projectId = positiveIntParam(c.req.query('projectId'));
    const env = c.env as Env;
    const key = `insights:delaytax:t:${tenantId}:d:${days}:p:${projectId ?? 0}`;
    return c.json(await getOrSetCached(env, key, () => computeDelayTaxonomy(db, tenantId, days, projectId), SHORT_TTL));
  });

  // Tag a task's delay reason (developer+ — the same audience that works the board).
  // Upserts on the per-task unique index so re-tagging replaces.
  router.post('/delay-taxonomy', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const body = await parseOptionalBody(c, DelayReasonBody);
    const taskId = Number(body.taskId);
    if (!Number.isInteger(taskId) || taskId <= 0) return c.json({ error: 'taskId is required' }, 400);
    if (!isDelayReason(body.reasonCode)) return c.json({ error: 'invalid reasonCode' }, 400);
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : null;

    const [row] = await db
      .insert(delayReasons)
      .values({ tenantId, taskId, reasonCode: body.reasonCode, notes, createdBy: userIdOf(c) })
      .onConflictDoUpdate({
        target: delayReasons.taskId,
        set: { reasonCode: body.reasonCode, notes, updatedAt: new Date() },
      })
      .returning();
    // Refresh the delay-taxonomy read caches for the common windows.
    for (const d of [30, 90]) await invalidateCached(c.env as Env, `insights:delaytax:t:${tenantId}:d:${d}`);
    return c.json(row, 201);
  });

  // Clear a task's delay reason.
  router.delete('/delay-taxonomy/:taskId', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isInteger(taskId)) return c.json({ error: 'invalid taskId' }, 400);
    await db.delete(delayReasons).where(and(eq(delayReasons.taskId, taskId), eq(delayReasons.tenantId, tenantId)));
    for (const d of [30, 90]) await invalidateCached(c.env as Env, `insights:delaytax:t:${tenantId}:d:${d}`);
    return c.json({ deleted: taskId });
  });

  // EMP-20 — export a key insight dataset (csv | printable html | xlsx | json).
  // A registered export source (also at /api/exports/sources/insights.dataset);
  // the dataset registry, formats and manager gate are declared on it.
  router.get('/export', exportSourceHandler(insightDatasetExportSource, db));

  return router;
}

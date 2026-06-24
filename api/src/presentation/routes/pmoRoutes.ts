/**
 * PMO tier — /api/pmo/*
 *
 * The enterprise anchor: portfolio / initiative / OKR objects ABOVE the project
 * tier, plus the live rollup that lights up the cost + delivery + DORA + outcome
 * collectors we already write on every run.
 *
 *   CRUD   /portfolios /initiatives /objectives /key-results
 *            → the generic segment-tracker factory (DRY: scoping, whitelisting,
 *              date coercion, manager-gated mutations all live in one place).
 *   GET    /tree        → portfolios ▸ initiatives ▸ linked projects (structure)
 *   GET    /rollup      → composed cost/DORA/outcome/OKR rollup for a scope
 *   PATCH  /projects/:id/link → link/unlink a project to an initiative
 *
 * Every write bumps a per-tenant PMO version token so the (version-keyed) tree
 * and rollup caches invalidate immediately; the rollup additionally carries a
 * short TTL so live agent spend stays fresh without cache thrash.
 */

import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { mountTrackers, scope } from './segmentTrackerRoutes';
import {
  bumpCacheVersion,
  getCacheVersion,
  getOrSetCached,
} from '../../infrastructure/cache/readThroughCache';
import {
  initiatives,
  keyResults,
  objectives,
  pmoDependencies,
  portfolios,
  projects,
} from '../../infrastructure/database/schema';
import {
  computePortfolioRollup,
  loadPmoTree,
  wouldCreateCycle,
  type PmoScopeKind,
} from '../../application/pmo/portfolioRollup';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** One version token per tenant: every PMO write bumps it, orphaning the tree +
 *  rollup caches that embed it. */
function pmoVersionKey(tenantId: number): string {
  return `pmo-version:tenant:${tenantId}`;
}

const SCOPE_KINDS = new Set<PmoScopeKind>(['portfolio', 'initiative', 'workspace']);

export function createPmoRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Structure (management tree) ─────────────────────────────────────────────
  router.get('/tree', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const env = c.env as Env;
    const ver = await getCacheVersion(env, pmoVersionKey(tenantId));
    const key = `pmo:tree:t:${tenantId}:s:${segmentId}:v:${ver}`;
    const tree = await getOrSetCached(env, key, () => loadPmoTree(db, tenantId, segmentId));
    return c.json(tree);
  });

  // ── Rollup for a portfolio or initiative ────────────────────────────────────
  router.get('/rollup', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const kind = c.req.query('kind') as PmoScopeKind | undefined;
    // Workspace scope (org-level OKRs not attached to a portfolio/initiative) has
    // no entity id — use a fixed sentinel so the cache key stays stable.
    const id = kind === 'workspace' ? 'workspace' : c.req.query('id');
    if (!kind || !SCOPE_KINDS.has(kind)) return c.json({ error: 'kind must be portfolio|initiative|workspace' }, 400);
    if (!id) return c.json({ error: 'id is required' }, 400);

    const env = c.env as Env;
    const ver = await getCacheVersion(env, pmoVersionKey(tenantId));
    const key = `pmo:rollup:t:${tenantId}:s:${segmentId}:${kind}:${id}:v:${ver}`;
    // Structural writes bump the version token; live agent spend is written on the
    // hot metering path (far too frequent to version-bump) so a short TTL keeps
    // the spend figure fresh (≤60s lag) without cache thrash — same shape as ROI.
    const rollup = await getOrSetCached(
      env, key,
      () => computePortfolioRollup(db, tenantId, segmentId, { kind, id }, { now: Date.now() }),
      { kvTtlSeconds: 60, l1TtlMs: 15_000 },
    );
    if (!rollup) return c.json({ error: 'not found' }, 404);
    return c.json(rollup);
  });

  // ── Link / unlink a project to an initiative (the rollup join) ──────────────
  router.patch('/projects/:projectId/link', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId) || projectId <= 0) return c.json({ error: 'invalid projectId' }, 400);
    const body = await c.req.json<{ initiativeId?: string | null }>();
    const initiativeId = body.initiativeId ?? null;

    // Validate the target initiative belongs to this tenant/segment before linking.
    if (initiativeId != null) {
      const [init] = await db
        .select({ id: initiatives.id })
        .from(initiatives)
        .where(and(eq(initiatives.id, initiativeId), eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, segmentId)));
      if (!init) return c.json({ error: 'initiative not found' }, 404);
    }

    const rows = await db
      .update(projects)
      .set({ initiativeId, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId), eq(projects.segmentId, segmentId)))
      .returning({ id: projects.id, initiativeId: projects.initiativeId });
    if (!rows[0]) return c.json({ error: 'project not found' }, 404);

    await bumpCacheVersion(c.env as Env, pmoVersionKey(tenantId));
    return c.json(rows[0]);
  });

  // ── Initiative dependency edges (blocker → blocked; critical-path input) ────
  router.post('/dependencies', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<{ fromInitiativeId?: string; toInitiativeId?: string }>();
    const from = body.fromInitiativeId;
    const to = body.toInitiativeId;
    if (!from || !to) return c.json({ error: 'fromInitiativeId and toInitiativeId are required' }, 400);
    if (from === to) return c.json({ error: 'an initiative cannot depend on itself' }, 400);

    // Both endpoints must belong to this tenant/segment.
    const ends = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(and(inArray(initiatives.id, [from, to]), eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, segmentId)));
    if (ends.length !== 2) return c.json({ error: 'initiative not found' }, 404);

    // Reject an edge that would close a cycle in the existing dependency graph.
    const existing = await db
      .select({ fromInitiativeId: pmoDependencies.fromInitiativeId, toInitiativeId: pmoDependencies.toInitiativeId })
      .from(pmoDependencies)
      .where(and(eq(pmoDependencies.tenantId, tenantId), eq(pmoDependencies.segmentId, segmentId)));
    if (wouldCreateCycle(existing, from, to)) return c.json({ error: 'that dependency would create a cycle' }, 409);

    const rows = await db
      .insert(pmoDependencies)
      .values({ tenantId, segmentId, fromInitiativeId: from, toInitiativeId: to })
      .onConflictDoNothing({ target: [pmoDependencies.fromInitiativeId, pmoDependencies.toInitiativeId] })
      .returning();
    await bumpCacheVersion(c.env as Env, pmoVersionKey(tenantId));
    return c.json(rows[0] ?? { fromInitiativeId: from, toInitiativeId: to }, 201);
  });

  router.delete('/dependencies/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const rows = await db
      .delete(pmoDependencies)
      .where(and(eq(pmoDependencies.id, id), eq(pmoDependencies.tenantId, tenantId), eq(pmoDependencies.segmentId, segmentId)))
      .returning({ id: pmoDependencies.id });
    if (!rows[0]) return c.json({ error: 'not found' }, 404);
    await bumpCacheVersion(c.env as Env, pmoVersionKey(tenantId));
    return c.json({ deleted: rows[0].id });
  });

  // ── CRUD for the four PMO entities (generic tracker factory) ────────────────
  const bumpVersionKeys = (tenantId: number) => [pmoVersionKey(tenantId)];
  mountTrackers(router, db, [
    {
      path: '/portfolios',
      table: portfolios,
      opts: {
        fields: ['name', 'description', 'status', 'ownerUserId', 'targetDate'],
        required: ['name'],
        cacheNs: 'pmo-portfolios',
        bumpVersionKeys,
      },
    },
    {
      path: '/initiatives',
      table: initiatives,
      opts: {
        fields: ['name', 'description', 'status', 'portfolioId', 'ownerUserId', 'targetDate'],
        required: ['name'],
        cacheNs: 'pmo-initiatives',
        bumpVersionKeys,
      },
    },
    {
      path: '/objectives',
      table: objectives,
      opts: {
        fields: ['title', 'description', 'period', 'status', 'portfolioId', 'initiativeId', 'ownerUserId'],
        required: ['title'],
        cacheNs: 'pmo-objectives',
        bumpVersionKeys,
      },
    },
    {
      path: '/key-results',
      table: keyResults,
      opts: {
        fields: ['title', 'metricType', 'startValue', 'targetValue', 'currentValue', 'unit', 'status', 'objectiveId'],
        required: ['title', 'objectiveId'],
        cacheNs: 'pmo-key-results',
        bumpVersionKeys,
      },
    },
  ]);

  return router;
}

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
  objectiveLinks,
  objectives,
  pmoDependencies,
  portfolios,
  projects,
  tasks,
} from '../../infrastructure/database/schema';
import {
  computePortfolioRollup,
  loadPmoTree,
  wouldCreateCycle,
  type PmoScopeKind,
} from '../../application/pmo/portfolioRollup';
import { computeValueStream } from '../../application/pmo/valueStream';
import { invalidateProjectsList, projectsListVersionKey } from './projectRoutes';
import { convertWorkItemType, ConvertError } from '../../application/workitem/convertWorkItemType';
import { TaskService } from '../../application/task/TaskService';
import { notSystemTask } from '../../application/task/taskScope';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import {
  classifyCostClass,
  loadPlanningSpine,
  type CostClass,
} from '../../application/pmo/planningSpine';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** One version token per tenant: every PMO write bumps it, orphaning the tree +
 *  rollup + spine caches that embed it. Exported so cross-cutting writes (e.g. a
 *  time-entry, which changes spine human cost) can invalidate the spine too. */
export function pmoVersionKey(tenantId: number): string {
  return `pmo-version:tenant:${tenantId}`;
}

const SCOPE_KINDS = new Set<PmoScopeKind>(['portfolio', 'initiative', 'project', 'workspace']);

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
    if (!kind || !SCOPE_KINDS.has(kind)) return c.json({ error: 'kind must be portfolio|initiative|project|workspace' }, 400);
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

  // ── Value stream: the initiative dependency graph + per-node delivery progress
  //    + critical path (the cross-artifact "where is value stuck" view). Reuses the
  //    rollup's dependency math; version-keyed + short TTL like the rollup. ───────
  router.get('/value-stream', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const env = c.env as Env;
    const ver = await getCacheVersion(env, pmoVersionKey(tenantId));
    const key = `pmo:value-stream:t:${tenantId}:s:${segmentId}:v:${ver}`;
    const vs = await getOrSetCached(env, key, () => computeValueStream(db, tenantId, segmentId), { kvTtlSeconds: 60, l1TtlMs: 15_000 });
    return c.json(vs);
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

  // ── Planning spine: the unified, dated, cost-bearing hierarchy ──────────────
  // One read powers the nested Gantt, the $-at-any-level rollup, AND the
  // CAPEX/OPEX reconciliation stage (each node carries cost, effective class,
  // anomaly flag and an agent suggestion).
  router.get('/spine', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const env = c.env as Env;
    const projectRaw = Number(c.req.query('project'));
    const projectId = Number.isFinite(projectRaw) && projectRaw > 0 ? projectRaw : undefined;
    const ver = await getCacheVersion(env, pmoVersionKey(tenantId));
    const key = `pmo:spine:t:${tenantId}:s:${segmentId}:p:${projectId ?? 'all'}:v:${ver}`;
    const spine = await getOrSetCached(
      env, key,
      () => loadPlanningSpine(db, tenantId, segmentId, { projectId }),
      { kvTtlSeconds: 60, l1TtlMs: 15_000 }, // live LLM spend rides the hot path — short TTL keeps it fresh
    );
    return c.json(spine);
  });

  // ── Period-bounded CapEx/OpEx finance export (CSV) ──────────────────────────
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD bounds the LLM + logged-time cost; ?project= scopes.
  router.get('/spine/export.csv', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const from = c.req.query('from');
    const to = c.req.query('to');
    const dateOk = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const window = dateOk(from) && dateOk(to) ? { from, to } : undefined;
    const projectRaw = Number(c.req.query('project'));
    const projectId = Number.isFinite(projectRaw) && projectRaw > 0 ? projectRaw : undefined;

    const spine = await loadPlanningSpine(db, tenantId, segmentId, { projectId, window });
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['kind', 'id', 'title', 'effective_cost_class', 'llm_usd', 'human_usd', 'total_usd', 'capex_usd', 'opex_usd'];
    const lines = [header.join(',')];
    for (const n of spine.nodes) {
      lines.push([n.kind, n.id, esc(n.title), n.effectiveCostClass ?? '', n.cost.llmUsd.toFixed(2), n.cost.humanUsd.toFixed(2), n.cost.totalUsd.toFixed(2), n.cost.capexUsd.toFixed(2), n.cost.opexUsd.toFixed(2)].join(','));
    }
    lines.push(['TOTAL', '', '', '', spine.totals.llmUsd.toFixed(2), spine.totals.humanUsd.toFixed(2), spine.totals.totalUsd.toFixed(2), spine.totals.capexUsd.toFixed(2), spine.totals.opexUsd.toFixed(2)].join(','));
    const suffix = window ? `${window.from}_${window.to}` : 'all';
    return new Response(lines.join('\n'), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="capex-opex-${suffix}.csv"` },
    });
  });

  // ── CAPEX/OPEX classification: set the class on any level, or run the agent ──
  const COST_KINDS = new Set(['portfolio', 'objective', 'initiative', 'epic', 'task']);
  const isCostClassValue = (v: unknown): v is CostClass | null => v === 'capex' || v === 'opex' || v === null;

  router.patch('/cost-class', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<{ kind?: string; id?: string; costClass?: CostClass | null; source?: string }>();
    const kind = body.kind;
    if (!kind || !COST_KINDS.has(kind)) return c.json({ error: 'kind must be portfolio|objective|initiative|epic|task' }, 400);
    if (body.id == null) return c.json({ error: 'id is required' }, 400);
    if (!isCostClassValue(body.costClass ?? null)) return c.json({ error: 'costClass must be capex|opex|null' }, 400);
    const costClass = body.costClass ?? null;
    // A human PM verifying/recategorising is 'manual' (and verifies the row); an
    // agent-applied class is 'agent' (still needs PM verification).
    const src = body.source === 'agent' ? 'agent' : 'manual';

    if (kind === 'task' || kind === 'epic') {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return c.json({ error: 'invalid task id' }, 400);
      const rows = await db.update(tasks)
        .set({ costClass, costClassSource: src, costClassVerified: src === 'manual', updatedAt: new Date() })
        .where(and(eq(tasks.id, id), eq(tasks.segmentId, segmentId)))
        .returning({ id: tasks.id });
      if (!rows[0]) return c.json({ error: 'not found' }, 404);
    } else {
      const table = kind === 'portfolio' ? portfolios : kind === 'objective' ? objectives : initiatives;
      const rows = await db.update(table)
        .set({ costClass, costClassSource: src, updatedAt: new Date() })
        .where(and(eq(table.id, body.id), eq(table.tenantId, tenantId), eq(table.segmentId, segmentId)))
        .returning({ id: table.id });
      if (!rows[0]) return c.json({ error: 'not found' }, 404);
    }
    await bumpCacheVersion(c.env as Env, pmoVersionKey(tenantId));
    return c.json({ ok: true });
  });

  // Agent classifier: suggest (and optionally apply) CAPEX/OPEX for tasks/epics
  // that have no manual/verified class yet. Never overwrites a PM decision.
  router.post('/cost-class/classify', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<{ apply?: boolean }>().catch(() => ({ apply: true }));
    const apply = body.apply !== false;
    const taskRows = await db
      .select({ id: tasks.id, title: tasks.title, description: tasks.description, taskType: tasks.taskType, actionType: tasks.actionType, source: tasks.source, allocationCategory: tasks.allocationCategory, costClass: tasks.costClass, costClassSource: tasks.costClassSource, costClassVerified: tasks.costClassVerified })
      .from(tasks).where(and(eq(tasks.segmentId, segmentId), notSystemTask));
    const targets = taskRows.filter((t) => !t.costClassVerified && t.costClassSource !== 'manual');
    const suggestions = targets.map((t) => ({ id: t.id, title: t.title, suggestion: classifyCostClass(t) }));
    if (apply && suggestions.length) {
      // One UPDATE per class bucket keeps it to two statements (neon-http: no interactive tx).
      for (const cls of ['capex', 'opex'] as CostClass[]) {
        const ids = suggestions.filter((s) => s.suggestion.costClass === cls).map((s) => s.id);
        if (ids.length) {
          await db.update(tasks)
            .set({ costClass: cls, costClassSource: 'agent', updatedAt: new Date() })
            .where(and(inArray(tasks.id, ids), eq(tasks.segmentId, segmentId)));
        }
      }
      await bumpCacheVersion(c.env as Env, pmoVersionKey(tenantId));
    }
    return c.json({ classified: suggestions.length, applied: apply, suggestions });
  });

  // ── Objective ↔ work-item links (an OKR owns initiatives / epics / tasks) ───
  router.post('/objectives/:id/links', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const objectiveId = c.req.param('id');
    const body = await c.req.json<{ linkKind?: string; initiativeId?: string; taskId?: number }>();
    const linkKind = body.linkKind;
    if (linkKind !== 'initiative' && linkKind !== 'epic' && linkKind !== 'task') {
      return c.json({ error: 'linkKind must be initiative|epic|task' }, 400);
    }
    const [obj] = await db.select({ id: objectives.id }).from(objectives)
      .where(and(eq(objectives.id, objectiveId), eq(objectives.tenantId, tenantId), eq(objectives.segmentId, segmentId)));
    if (!obj) return c.json({ error: 'objective not found' }, 404);

    const values = linkKind === 'initiative'
      ? { tenantId, segmentId, objectiveId, linkKind, initiativeId: body.initiativeId ?? null, taskId: null }
      : { tenantId, segmentId, objectiveId, linkKind, initiativeId: null, taskId: body.taskId ?? null };
    if (linkKind === 'initiative' && !values.initiativeId) return c.json({ error: 'initiativeId is required' }, 400);
    if (linkKind !== 'initiative' && values.taskId == null) return c.json({ error: 'taskId is required' }, 400);

    const rows = await db.insert(objectiveLinks).values(values).returning();
    await bumpCacheVersion(c.env as Env, pmoVersionKey(tenantId));
    // A task/initiative link changes the project's linkedGoalCount → refresh the 360.
    await invalidateProjectsList(c.env as Env, tenantId).catch(() => {});
    return c.json(rows[0], 201);
  });

  router.delete('/objectives/:id/links/:linkId', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const rows = await db.delete(objectiveLinks)
      .where(and(eq(objectiveLinks.id, c.req.param('linkId')), eq(objectiveLinks.objectiveId, c.req.param('id')), eq(objectiveLinks.tenantId, tenantId), eq(objectiveLinks.segmentId, segmentId)))
      .returning({ id: objectiveLinks.id });
    if (!rows[0]) return c.json({ error: 'not found' }, 404);
    await bumpCacheVersion(c.env as Env, pmoVersionKey(tenantId));
    await invalidateProjectsList(c.env as Env, tenantId).catch(() => {});
    return c.json({ deleted: rows[0].id });
  });

  // POST /api/pmo/objectives/:id/convert-type — demote an OKR Objective back to a
  // board task/epic (the reverse of tasks/:id/convert-type → objective). Re-parents
  // linked tasks; key results are dropped. Shared logic in convertWorkItemType.
  router.post('/objectives/:id/convert-type', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<{ target?: 'task' | 'epic'; projectId?: number | null }>();
    const target = body.target;
    if (target !== 'task' && target !== 'epic') return c.json({ error: 'target must be task|epic' }, 400);
    try {
      const result = await convertWorkItemType(
        { db, tasks: new TaskService(new TaskRepository(db), new ProjectRepository(db)), env: c.env as Env },
        { tenantId, segmentId, sourceKind: 'objective', sourceId: c.req.param('id'), target, projectId: body.projectId ?? undefined },
      );
      return c.json(result);
    } catch (e) {
      if (e instanceof ConvertError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  // ── CRUD for the four PMO entities (generic tracker factory) ────────────────
  const bumpVersionKeys = (tenantId: number) => [pmoVersionKey(tenantId)];
  // Objectives additionally carry a PROJECT scope (0268) that feeds the projects-list
  // aggregate the Project 360 reads (linkedGoalCount / Direction). Bust that cache too
  // so a create/update/delete refreshes the 360 immediately, not after its short TTL.
  const objectiveBumpKeys = (tenantId: number) => [pmoVersionKey(tenantId), projectsListVersionKey(tenantId)];
  mountTrackers(router, db, [
    {
      path: '/portfolios',
      table: portfolios,
      opts: {
        fields: ['name', 'description', 'status', 'ownerUserId', 'targetDate', 'costClass', 'costClassSource'],
        required: ['name'],
        cacheNs: 'pmo-portfolios',
        bumpVersionKeys,
      },
    },
    {
      path: '/initiatives',
      table: initiatives,
      opts: {
        fields: ['name', 'description', 'status', 'portfolioId', 'ownerUserId', 'startDate', 'targetDate', 'costClass', 'costClassSource'],
        required: ['name'],
        cacheNs: 'pmo-initiatives',
        bumpVersionKeys,
      },
    },
    {
      path: '/objectives',
      table: objectives,
      opts: {
        fields: ['title', 'description', 'period', 'status', 'projectId', 'portfolioId', 'initiativeId', 'ownerUserId', 'startDate', 'endDate', 'costClass', 'costClassSource'],
        required: ['title'],
        cacheNs: 'pmo-objectives',
        bumpVersionKeys: objectiveBumpKeys,
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

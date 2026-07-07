/**
 * Role-insight lenses — /api/insights/*
 *
 * The rollup-only views that make the `insights.*` RBAC gates live. Every lens
 * reads collectors that already exist (no new collection) and is:
 *   - server-gated by role (mirrors the client CAPABILITIES map — manager for the
 *     exec lenses, developer for delivery/DORA),
 *   - cached: the underlying tables are hot-write (every run / call / tool / deploy)
 *     so a short TTL keeps figures fresh without version-bumping the metering path;
 *     the one structural input (budgets) carries a version token bumped on write.
 *
 *   GET /engineering   LENS #1 — AI effectiveness (run_model_outcomes)   [manager]
 *   GET /dora          LENS #2 — DORA four-keys (deployment_events)      [developer]
 *   GET /finance       LENS #3 — FinOps (llm_usage_log + budgets)        [manager]
 *   GET /compliance    LENS #6 — audit summary (tool_audit_events)       [manager]
 *   GET /compliance/export?format=csv|json — evidence pack download      [manager]
 *   …/budgets          FinOps budget CRUD (generic tracker, manager-gated writes)
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requirePlanFeature } from '../middleware/insightPlanGate';
import { TenantRole } from '../../domain/shared/types';
import { clamp, clampScore } from '../../domain/shared/numbers';
import { mountTrackers, scope } from './segmentTrackerRoutes';
import { getOrSetCached, getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { and, desc, eq } from 'drizzle-orm';
import {
  allocationGoals, budgets, teamMembers, deliverableUpdates, users,
  prodIncidents, supportTickets, uptimeSamples,
  headcountEvents, openPositions,
  aiToolAdoption, aiProgramInitiatives,
  rdFinancialsQuarterly, rdRevenueQuarterly, rdFteAllocationQuarterly,
} from '../../infrastructure/database/schema';
import { computeEngineeringInsights } from '../../application/insights/engineeringInsights';
import { computeDora } from '../../application/metrics/workforceMetrics';
import { computeFinanceInsights } from '../../application/insights/financeInsights';
import { computeAllocationInsights, computeAllocationHistory, type AllocationGoalMap } from '../../application/insights/allocationInsights';
import { computeDeliveryInsights, type DeliverableScope } from '../../application/insights/deliveryInsights';
import { buildScenario } from '../../application/insights/deliveryScenario';
import { computeBottleneckInsights } from '../../application/insights/bottleneckInsights';
import { computeLifecycleInsights } from '../../application/insights/lifecycleInsights';
import { normalizeAllocationCategory } from '../../application/llm/allocationCategories';
import { computeComplianceSummary, buildEvidencePack, evidencePackToCsv } from '../../application/insights/complianceInsights';
import { computeQualityInsights } from '../../application/insights/qualityInsights';
import { computePeopleInsights } from '../../application/insights/peopleInsights';
import { computeRdFinancials } from '../../application/insights/rdFinancialsInsights';
import { importBoardRows, isImportDataset, IMPORT_DATASETS } from '../../application/insights/boardImport';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/**
 * The paid-plan feature gating the premium exec lenses (CTO/CFO/PMO analytical
 * views). Applied as a middleware AFTER requireRole so a premium lens needs both
 * the role AND the plan. Fail-open until the flag exists in PlanLimits (see
 * insightPlanGate). Developer-facing delivery lenses (dora/delivery/bottlenecks/
 * lifecycle) stay role-only — they're the IC's day-to-day view, not a paid tier.
 */
const PREMIUM_INSIGHTS = 'advancedInsights';

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

/** Current calendar month 'YYYY-MM' (UTC) when no `?period=` given. */
function currentPeriodMonth(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parsePeriod(raw: string | undefined, now: number): string {
  return raw && /^\d{4}-\d{2}$/.test(raw) ? raw : currentPeriodMonth(now);
}

// Insights cache version-key helpers live in application/insights/versionKeys so
// ingest code (boardsync) can import them without an application→presentation
// edge. Re-exported here for back-compat with existing import sites.
export {
  financeVersionKey, allocationVersionKey, qualityVersionKey,
  peopleVersionKey, aiProgramVersionKey, rdFinancialsVersionKey,
} from '../../application/insights/versionKeys';
import {
  financeVersionKey, allocationVersionKey, qualityVersionKey,
  peopleVersionKey, aiProgramVersionKey, rdFinancialsVersionKey,
} from '../../application/insights/versionKeys';

/** Parse `?fy=` (fiscal year) → 4-digit int, default current UTC year. */
function parseFiscalYear(raw: string | undefined, now: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : new Date(now).getUTCFullYear();
}

/** Parse an optional positive-integer query param (projectId / teamId). */
function parseId(raw: string | undefined): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function createInsightsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // LENS #1 — AI effectiveness (manager, premium)
  router.get('/engineering', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:eng:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeEngineeringInsights(db, tenantId, days), SHORT_TTL));
  });

  // LENS #2 — DORA (developer+; reuses the shared DORA rollup)
  router.get('/dora', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:dora:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeDora(db, tenantId, days), SHORT_TTL));
  });

  // LENS #3 — FinOps (manager). Budget writes bump the finance version token.
  router.get('/finance', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const now = Date.now();
    const period = parsePeriod(c.req.query('period'), now);
    const env = c.env as Env;
    const ver = await getCacheVersion(env, financeVersionKey(tenantId));
    const key = `insights:fin:t:${tenantId}:s:${segmentId}:p:${period}:v:${ver}`;
    return c.json(await getOrSetCached(env, key, () => computeFinanceInsights(db, tenantId, segmentId, period, now), SHORT_TTL));
  });

  // LENS — investment allocation: categorical effort-in-TIME + capex/opex split
  // (EMP-1 / EMP-18), with goal variance (EMP-2). Manager-gated. Cached on a short
  // TTL (tasks are hot-write) with the goals version token folded into the key so a
  // goal edit refreshes immediately.
  router.get('/allocation', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const now = Date.now();
    const period = parsePeriod(c.req.query('period'), now);
    const projectId = parseId(c.req.query('projectId'));
    const teamId = parseId(c.req.query('teamId'));
    const env = c.env as Env;

    // Resolve the team's member identities (kind:ref) for the team grain.
    let memberKeys: Set<string> | undefined;
    if (teamId != null) {
      const members = await db
        .select({ kind: teamMembers.memberKind, ref: teamMembers.memberRef })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));
      memberKeys = new Set(members.map((m) => `${m.kind}:${m.ref}`));
    }

    // Goal targets for the active scope/period → category → target_pct.
    const scopeKind = teamId != null ? 'team' : projectId != null ? 'project' : 'tenant';
    const goalRows = await db
      .select({ category: allocationGoals.category, targetPct: allocationGoals.targetPct, scopeKind: allocationGoals.scopeKind, teamId: allocationGoals.teamId, projectId: allocationGoals.projectId })
      .from(allocationGoals)
      .where(and(eq(allocationGoals.tenantId, tenantId), eq(allocationGoals.periodMonth, period), eq(allocationGoals.scopeKind, scopeKind)));
    const goals: AllocationGoalMap = new Map();
    for (const g of goalRows) {
      if (scopeKind === 'team' && g.teamId !== teamId) continue;
      if (scopeKind === 'project' && g.projectId !== projectId) continue;
      goals.set(normalizeAllocationCategory(g.category), g.targetPct);
    }

    const ver = await getCacheVersion(env, allocationVersionKey(tenantId));
    const key = `insights:alloc:t:${tenantId}:d:${days}:p:${period}:pr:${projectId ?? 0}:tm:${teamId ?? 0}:v:${ver}`;
    return c.json(await getOrSetCached(
      env, key,
      // lineage:true → CAPEX/OPEX honours spine objective/initiative inheritance (SPINE-2). Cached.
      () => computeAllocationInsights(db, tenantId, days, now, { projectId, memberKeys }, goals, { lineage: true }),
      SHORT_TTL,
    ));
  });

  // LENS — capitalization history: per-month capitalized FTE-months + cost split,
  // the cost-report "Historical Months" trend (Jellyfish parity). Manager-gated;
  // same scoping + version token as /allocation so it refreshes in lock-step.
  router.get('/allocation/history', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const now = Date.now();
    const months = Math.min(24, Math.max(1, Number(c.req.query('months')) || 12));
    const projectId = parseId(c.req.query('projectId'));
    const teamId = parseId(c.req.query('teamId'));
    const env = c.env as Env;

    let memberKeys: Set<string> | undefined;
    if (teamId != null) {
      const members = await db
        .select({ kind: teamMembers.memberKind, ref: teamMembers.memberRef })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));
      memberKeys = new Set(members.map((m) => `${m.kind}:${m.ref}`));
    }

    const ver = await getCacheVersion(env, allocationVersionKey(tenantId));
    const key = `insights:allochist:t:${tenantId}:m:${months}:pr:${projectId ?? 0}:tm:${teamId ?? 0}:v:${ver}`;
    return c.json(await getOrSetCached(
      env, key,
      () => computeAllocationHistory(db, tenantId, months, now, { projectId, memberKeys }, { lineage: true }),
      SHORT_TTL,
    ));
  });

  // LENS — delivery: burnup/burndown + completion forecast + scope creep for a
  // chosen deliverable (initiative | project | release | sprint). Developer-gated
  // (delivery is an IC/Tech-Lead/EM view). Short TTL over hot task tables.
  router.get('/delivery', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    const now = Date.now();
    const rawScope = c.req.query('scope');
    const scopeKind = (['initiative', 'project', 'release', 'sprint'] as const).includes(rawScope as DeliverableScope)
      ? (rawScope as DeliverableScope) : null;
    const scopeId = c.req.query('id');
    if (!scopeKind || !scopeId) return c.json({ error: 'scope (initiative|project|release|sprint) and id are required' }, 400);

    const key = `insights:deliv:t:${tenantId}:s:${scopeKind}:id:${scopeId}`;
    const result = await getOrSetCached(env, key, () => computeDeliveryInsights(db, tenantId, scopeKind, scopeId, now), SHORT_TTL);
    if (!result) return c.json({ error: 'deliverable not found' }, 404);
    return c.json(result);
  });

  // SCENARIO PLANNER (Jellyfish "Scenario Planner") — model how the chosen
  // deliverable's completion date moves under different team size / focus / scope,
  // graded against its target. Reads the delivery rollup as the baseline (shared
  // cache key) then applies the pure what-if math. Developer-gated (same audience).
  router.get('/delivery/scenario', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    const now = Date.now();
    const rawScope = c.req.query('scope');
    const scopeKind = (['initiative', 'project', 'release', 'sprint'] as const).includes(rawScope as DeliverableScope)
      ? (rawScope as DeliverableScope) : null;
    const scopeId = c.req.query('id');
    if (!scopeKind || !scopeId) return c.json({ error: 'scope (initiative|project|release|sprint) and id are required' }, 400);

    const key = `insights:deliv:t:${tenantId}:s:${scopeKind}:id:${scopeId}`;
    const baseline = await getOrSetCached(env, key, () => computeDeliveryInsights(db, tenantId, scopeKind, scopeId, now), SHORT_TTL);
    if (!baseline) return c.json({ error: 'deliverable not found' }, 404);

    const num = (raw: string | undefined, def: number) => { const n = Number(raw); return Number.isFinite(n) ? n : def; };
    const developers = clampScore(num(c.req.query('developers'), Math.max(1, baseline.activeContributors)));
    const attentionPct = clampScore(num(c.req.query('attentionPct'), 100));
    const scopeDelta = clamp(num(c.req.query('scopeDelta'), 0), -100_000, 100_000);

    const scenario = buildScenario(
      { openTasks: baseline.openTasks, throughputPerWeek: baseline.throughputPerWeek, activeContributors: baseline.activeContributors, targetDate: baseline.targetDate, now },
      { developers, attentionPct, scopeDelta },
    );
    return c.json({
      baseline: {
        openTasks: baseline.openTasks, throughputPerWeek: baseline.throughputPerWeek,
        activeContributors: baseline.activeContributors, targetDate: baseline.targetDate,
        forecastDate: baseline.forecastDate, status: baseline.status,
      },
      scenario,
    });
  });

  // Deliverable qualitative UPDATE stream (EMP-11) — the human narrative companion
  // to /delivery's quantitative status. Developer-gated (same audience). Newest
  // first, bounded. Not cached (a small, hot, append-mostly feed).
  const DELIV_SCOPES = ['initiative', 'project', 'release', 'sprint'] as const;
  router.get('/deliverable-updates', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const sk = c.req.query('scope');
    const sid = c.req.query('id');
    if (!DELIV_SCOPES.includes(sk as never) || !sid) return c.json({ error: 'scope and id are required' }, 400);
    const rows = await db
      .select({
        id: deliverableUpdates.id, scopeKind: deliverableUpdates.scopeKind, scopeId: deliverableUpdates.scopeId,
        statusLabel: deliverableUpdates.statusLabel, body: deliverableUpdates.body,
        authorId: deliverableUpdates.authorId, authorName: deliverableUpdates.authorName,
        authorDisplay: users.displayName, createdAt: deliverableUpdates.createdAt,
      })
      .from(deliverableUpdates)
      .leftJoin(users, eq(users.id, deliverableUpdates.authorId))
      .where(and(eq(deliverableUpdates.tenantId, tenantId), eq(deliverableUpdates.scopeKind, sk!), eq(deliverableUpdates.scopeId, sid)))
      .orderBy(desc(deliverableUpdates.createdAt))
      .limit(100);
    return c.json(rows.map((r) => ({ ...r, authorName: r.authorDisplay ?? r.authorName, authorDisplay: undefined })));
  });

  router.post('/deliverable-updates', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const userId = (c as unknown as { get(k: string): string | undefined }).get('userId') ?? null;
    type UpdateBody = { scopeKind?: string; scopeId?: string; body?: string; statusLabel?: string };
    const body = await c.req.json<UpdateBody>().catch(() => ({} as UpdateBody));
    if (!DELIV_SCOPES.includes(body.scopeKind as never) || !body.scopeId || !body.body?.trim()) {
      return c.json({ error: 'scopeKind, scopeId and body are required' }, 400);
    }
    const status = ['on_track', 'at_risk', 'blocked', 'done', 'note'].includes(String(body.statusLabel)) ? String(body.statusLabel) : null;
    const [row] = await db
      .insert(deliverableUpdates)
      .values({ tenantId, scopeKind: body.scopeKind!, scopeId: body.scopeId!, body: body.body!.trim().slice(0, 4000), statusLabel: status, authorId: userId })
      .returning();
    return c.json(row, 201);
  });

  router.delete('/deliverable-updates/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    await db.delete(deliverableUpdates).where(and(eq(deliverableUpdates.id, id), eq(deliverableUpdates.tenantId, tenantId)));
    return c.json({ deleted: id });
  });

  // LENS — Bottleneck analysis: WHICH stage stalls work and WHY — time-in-status
  // per stage, the slowest stage, rework/reopen loops, and currently-aging WIP.
  // Orthogonal to /delivery (which forecasts completion). Developer-gated (an
  // IC/Tech-Lead view, same audience as /delivery + /dora). Short TTL over the
  // hot task + transition tables.
  router.get('/bottlenecks', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:bottlenecks:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeBottleneckInsights(db, tenantId, days), SHORT_TTL));
  });

  // LIFE CYCLE EXPLORER (Jellyfish "Life Cycle Explorer") — time per canonical SDLC
  // phase (Refinement → Work → Review → Deploy) + the end-to-end lifecycle trend.
  // Reuses the bottleneck stage-dwell derivation, mapped to phases. Developer-gated.
  router.get('/delivery/lifecycle', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:lifecycle:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeLifecycleInsights(db, tenantId, days), SHORT_TTL));
  });

  // LENS — Quality (board Quality slide): prod incidents / support / uptime /
  // defect aging. Manager-gated. Hot-write tables → short TTL with a version token
  // bumped on every quality CRUD write so a manual entry refreshes immediately.
  router.get('/quality', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'), 90);
    const env = c.env as Env;
    const ver = await getCacheVersion(env, qualityVersionKey(tenantId));
    const key = `insights:quality:t:${tenantId}:d:${days}:v:${ver}`;
    return c.json(await getOrSetCached(env, key, () => computeQualityInsights(db, tenantId, days), SHORT_TTL));
  });

  // LENS — People (board People slide): headcount waterfall / attrition / ramp /
  // open positions / dev satisfaction (reuses the DevEx lens). Manager-gated.
  router.get('/people', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const months = Math.min(24, Math.max(1, Number(c.req.query('months')) || 6));
    const env = c.env as Env;
    const ver = await getCacheVersion(env, peopleVersionKey(tenantId));
    const key = `insights:people:t:${tenantId}:m:${months}:v:${ver}`;
    return c.json(await getOrSetCached(env, key, () => computePeopleInsights(db, tenantId, months), SHORT_TTL));
  });

  // LENS — R&D Financials (board Investment slide): disaggregated quarterly spend /
  // FTE / revenue ratio for a fiscal year. Manager-gated.
  router.get('/rd-financials/summary', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const now = Date.now();
    const fy = parseFiscalYear(c.req.query('fy'), now);
    const env = c.env as Env;
    const ver = await getCacheVersion(env, rdFinancialsVersionKey(tenantId));
    const key = `insights:rdfin:t:${tenantId}:fy:${fy}:v:${ver}`;
    return c.json(await getOrSetCached(env, key, () => computeRdFinancials(db, tenantId, fy), SHORT_TTL));
  });

  // Bulk import — CSV/JSON bulk entry for the manual board-deck datasets
  // (headcount, positions, R&D financials, support/incidents/uptime, AI program).
  // Manager-gated; one multi-row insert + a lens cache bump. The dataset list is
  // the single registry shared with the trackers (IMPORT_DATASETS).
  router.get('/import/datasets', requireRole(TenantRole.MANAGER), (c) =>
    c.json({ datasets: Object.fromEntries(Object.entries(IMPORT_DATASETS).map(([k, d]) => [k, d.columns.map((col) => ({ name: col.name, type: col.type, required: !!col.required }))])) }),
  );
  router.post('/import/:dataset', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const dataset = c.req.param('dataset');
    if (!isImportDataset(dataset)) return c.json({ error: `unknown dataset "${dataset}"` }, 400);
    const body = await c.req.json<{ rows?: Array<Record<string, unknown>> }>();
    const result = await importBoardRows(db, c.env as Env, tenantId, dataset, body.rows ?? []);
    return c.json(result, result.inserted > 0 ? 201 : 400);
  });

  // LENS #6 — compliance summary (manager)
  router.get('/compliance', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:comp:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeComplianceSummary(db, tenantId, days), SHORT_TTL));
  });

  // LENS #6 — evidence-pack export (manager). Not cached: it's a download, and the
  // bounded query is a deliberate point-in-time snapshot for an audit request.
  router.get('/compliance/export', requireRole(TenantRole.MANAGER), requirePlanFeature(PREMIUM_INSIGHTS), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'), 90);
    const format = c.req.query('format') === 'json' ? 'json' : 'csv';
    const rows = await buildEvidencePack(db, tenantId, days);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      return c.json({ generatedAt: new Date().toISOString(), windowDays: days, rows });
    }
    return new Response(evidencePackToCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="evidence-pack-${stamp}.csv"`,
      },
    });
  });

  // FinOps budget CRUD (generic tracker; writes manager-gated + bump finance version).
  mountTrackers(router, db, [
    {
      path: '/budgets',
      table: budgets,
      opts: {
        fields: ['scopeKind', 'projectId', 'initiativeId', 'periodMonth', 'limitUsd', 'notes'],
        required: ['periodMonth'],
        bumpVersionKeys: (t) => [financeVersionKey(t)],
      },
    },
    // Allocation goal CRUD (EMP-2) — desired investment mix per scope/period/category.
    {
      path: '/allocation-goals',
      table: allocationGoals,
      opts: {
        fields: ['scopeKind', 'teamId', 'projectId', 'periodMonth', 'category', 'targetPct', 'notes'],
        required: ['periodMonth', 'category'],
        bumpVersionKeys: (t) => [allocationVersionKey(t)],
      },
    },

    // ── Board-deck collectors (manual entry + connector fallback) ─────────────
    // QUALITY (board Quality slide).
    {
      path: '/quality/incidents',
      table: prodIncidents,
      opts: {
        fields: ['projectId', 'title', 'severity', 'status', 'isAlertOnly', 'source', 'externalRef', 'startedAt', 'acknowledgedAt', 'resolvedAt', 'impact', 'rootCause', 'postmortemUrl'],
        required: ['title'],
        bumpVersionKeys: (t) => [qualityVersionKey(t)],
      },
    },
    {
      path: '/quality/support-tickets',
      table: supportTickets,
      opts: {
        fields: ['source', 'externalRef', 'subject', 'category', 'isBug', 'priority', 'status', 'customerRef', 'openedAt', 'resolvedAt'],
        bumpVersionKeys: (t) => [qualityVersionKey(t)],
      },
    },
    {
      path: '/quality/uptime',
      table: uptimeSamples,
      opts: {
        fields: ['serviceName', 'periodDay', 'uptimePct', 'downtimeMinutes', 'source'],
        required: ['periodDay'],
        bumpVersionKeys: (t) => [qualityVersionKey(t)],
      },
    },
    // PEOPLE (board People slide).
    {
      path: '/people/headcount-events',
      table: headcountEvents,
      opts: {
        fields: ['memberKind', 'memberRef', 'memberName', 'eventType', 'teamId', 'effectiveOn', 'isVoluntary', 'reason'],
        required: ['eventType', 'effectiveOn'],
        bumpVersionKeys: (t) => [peopleVersionKey(t)],
      },
    },
    {
      path: '/people/positions',
      table: openPositions,
      opts: {
        fields: ['reqTitle', 'teamId', 'priority', 'status', 'openedOn', 'targetStartOn', 'filledOn', 'notes'],
        required: ['reqTitle'],
        bumpVersionKeys: (t) => [peopleVersionKey(t)],
      },
    },
    // AI PROGRAM (board AI slide) — layers on the existing aiImpact lens.
    {
      path: '/ai/tool-adoption',
      table: aiToolAdoption,
      opts: {
        fields: ['toolName', 'category', 'periodMonth', 'activeUsers', 'eligibleUsers', 'estHoursSaved', 'monthlyCostUsd', 'notes'],
        required: ['toolName', 'periodMonth'],
        bumpVersionKeys: (t) => [aiProgramVersionKey(t)],
      },
    },
    {
      path: '/ai/programs',
      table: aiProgramInitiatives,
      opts: {
        fields: ['initiativeId', 'programName', 'tier', 'investedUsd', 'status', 'objective', 'notes'],
        required: ['programName'],
        bumpVersionKeys: (t) => [aiProgramVersionKey(t)],
      },
    },
    // R&D FINANCIALS (board Investment slide).
    {
      path: '/rd-financials',
      table: rdFinancialsQuarterly,
      opts: {
        fields: ['fiscalYear', 'quarter', 'category', 'actualUsd', 'planUsd', 'source', 'notes'],
        required: ['fiscalYear', 'quarter', 'category'],
        bumpVersionKeys: (t) => [rdFinancialsVersionKey(t)],
      },
    },
    {
      path: '/rd-revenue',
      table: rdRevenueQuarterly,
      opts: {
        fields: ['fiscalYear', 'quarter', 'revenueUsd'],
        required: ['fiscalYear', 'quarter'],
        bumpVersionKeys: (t) => [rdFinancialsVersionKey(t)],
      },
    },
    {
      path: '/rd-fte',
      table: rdFteAllocationQuarterly,
      opts: {
        fields: ['fiscalYear', 'quarter', 'category', 'fte'],
        required: ['fiscalYear', 'quarter', 'category'],
        bumpVersionKeys: (t) => [rdFinancialsVersionKey(t)],
      },
    },
  ]);

  return router;
}

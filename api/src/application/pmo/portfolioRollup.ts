/**
 * PMO rollup — the live aggregation behind /api/pmo/rollup and /api/pmo/tree.
 *
 * The PMO tier (portfolio → initiative → project) carries NO new collectors: the
 * rollup is composed from sources that already exist, scoped to the set of
 * projects linked under the chosen tier (projects.initiative_id, 0213):
 *   - delivery: tasks lifecycle (created_at → completed_at)
 *   - spend:    llm_usage_log per-project cost (0103/0104)
 *   - DORA:     deployment_events (reuses workforceMetrics.rollupDora — DRY)
 *   - outcomes: run_model_outcomes score / merged rate
 *   - OKR:      objectives + key_results progress (pure math below)
 *   - deps:     pmo_dependencies (0216) → blocked initiatives + critical path
 *
 * Scope kinds: 'portfolio' (its initiatives' projects), 'initiative' (one
 * initiative's projects), 'project' (a single project's own OKRs + delivery),
 * 'workspace' (org-level OKRs not attached to any scope axis).
 *
 * Scoring lives in pure functions ({@link keyResultProgress},
 * {@link objectiveProgress}, {@link computeDependencyAnalysis}) so the math is
 * unit-testable without a DB.
 */

import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  deploymentEvents,
  initiatives,
  keyResults,
  llmUsageLog,
  objectiveLinks,
  objectives,
  pmoDependencies,
  portfolios,
  projects,
  runModelOutcomes,
  tasks,
} from '../../infrastructure/database/schema';
import { rollupDora, type DeployRow, type DoraRollup } from '../metrics/workforceMetrics';

const MILLICENTS_PER_USD = 100_000;
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;
const DEFAULT_DORA_DAYS = 30;

/** Statuses that count as "delivered" — excluded from blocked/critical-path. */
const DONE_STATUSES = new Set(['completed', 'archived']);
function isIncompleteStatus(status: string | null | undefined): boolean {
  return !DONE_STATUSES.has(status ?? '');
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ── Pure OKR math (unit-tested) ──────────────────────────────────────────────

export interface KeyResultLike {
  metricType: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
}

/**
 * Fraction [0,1] of a key result attained. Boolean KRs are binary (current ≥
 * target → done). Numeric/percent/currency KRs interpolate start→target so a KR
 * that starts at a non-zero baseline isn't double-counted. A zero-width target
 * (start === target) is "done" once current reaches it, else 0.
 */
export function keyResultProgress(kr: KeyResultLike): number {
  if (kr.metricType === 'boolean') return kr.currentValue >= kr.targetValue && kr.targetValue > 0 ? 1 : kr.currentValue >= 1 ? 1 : 0;
  const denom = kr.targetValue - kr.startValue;
  if (denom === 0) return kr.currentValue >= kr.targetValue ? 1 : 0;
  return clamp01((kr.currentValue - kr.startValue) / denom);
}

/** Objective progress = mean of its key results' progress (0 when it has none). */
export function objectiveProgress(krProgresses: number[]): number {
  if (krProgresses.length === 0) return 0;
  return krProgresses.reduce((a, b) => a + b, 0) / krProgresses.length;
}

// ── Pure dependency / critical-path math (unit-tested) ───────────────────────

export interface DepInitiative { id: string; name: string; status: string }
export interface DepEdge { fromInitiativeId: string; toInitiativeId: string }

export interface DependencyAnalysis {
  /** initiativeId → ids of initiatives that block it. */
  blockedBy: Record<string, string[]>;
  /** Longest chain of INCOMPLETE initiatives following blocker→blocked, in order. */
  criticalPath: string[];
  /** True if the incomplete-initiative dependency graph contains a cycle. */
  cycleDetected: boolean;
}

/**
 * Over a set of initiatives + blocker→blocked edges, compute who-blocks-whom and
 * the critical path (longest chain of still-incomplete initiatives). Done/archived
 * initiatives are treated as resolved and drop out of the path. DAG longest-path
 * via memoised DFS; a back-edge among incomplete nodes flags `cycleDetected`.
 */
export function computeDependencyAnalysis(inits: DepInitiative[], edges: DepEdge[]): DependencyAnalysis {
  const byId = new Map(inits.map((i) => [i.id, i]));
  const out = new Map<string, string[]>();
  const blockedBy: Record<string, string[]> = {};
  for (const i of inits) { out.set(i.id, []); blockedBy[i.id] = []; }
  for (const e of edges) {
    const adj = out.get(e.fromInitiativeId);
    if (adj && byId.has(e.toInitiativeId)) {
      adj.push(e.toInitiativeId);
      const blockers = blockedBy[e.toInitiativeId] ?? [];
      blockers.push(e.fromInitiativeId);
      blockedBy[e.toInitiativeId] = blockers;
    }
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const best = new Map<string, string[]>();
  let cycle = false;

  const dfs = (id: string): string[] => {
    if (!isIncompleteStatus(byId.get(id)?.status)) return [];
    const c = color.get(id) ?? WHITE;
    if (c === GRAY) { cycle = true; return []; }
    if (c === BLACK) return best.get(id) ?? [id];
    color.set(id, GRAY);
    let longest: string[] = [];
    for (const nxt of out.get(id) ?? []) {
      const chain = dfs(nxt);
      if (chain.length > longest.length) longest = chain;
    }
    color.set(id, BLACK);
    const result = [id, ...longest];
    best.set(id, result);
    return result;
  };

  let criticalPath: string[] = [];
  for (const i of inits) {
    if (!isIncompleteStatus(i.status)) continue;
    const chain = dfs(i.id);
    if (chain.length > criticalPath.length) criticalPath = chain;
  }
  return { blockedBy, criticalPath, cycleDetected: cycle };
}

// ── Rollup shapes ────────────────────────────────────────────────────────────

export type PmoScopeKind = 'portfolio' | 'initiative' | 'project' | 'workspace';

export interface KeyResultProgress {
  id: string;
  title: string;
  metricType: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string | null;
  progress: number; // 0..1
}

export interface ObjectiveLinkRef {
  id: string;
  kind: 'initiative' | 'epic' | 'task';
  refId: string;
  label: string;
}

export interface ObjectiveProgress {
  id: string;
  title: string;
  period: string | null;
  status: string;
  initiativeId: string | null;
  startDate: string | null;
  endDate: string | null;
  costClass: string | null;
  progress: number; // 0..1
  keyResults: KeyResultProgress[];
  /** Lineage: initiatives / epics / tasks this objective owns (0225). */
  links: ObjectiveLinkRef[];
}

export interface InitiativeRef { initiativeId: string; name: string; status: string }

export interface PmoRollup {
  scope: { kind: PmoScopeKind; id: string; name: string };
  projectCount: number;
  initiativeCount: number; // portfolio scope only (0 otherwise)
  delivery: {
    totalTasks: number;
    completedCount: number;
    openCount: number;
    avgCycleTimeHours: number;
    throughputPerWeek: number;
  };
  spend: { agentLlmCostUsd: number };
  dora: DoraRollup;
  outcomes: { runs: number; avgScore: number; mergedRatePct: number | null };
  okr: { objectives: ObjectiveProgress[]; avgProgress: number };
  byInitiative: Array<{
    initiativeId: string;
    name: string;
    status: string;
    projectCount: number;
    completedCount: number;
    agentLlmCostUsd: number;
    avgProgress: number;
    isBlocked: boolean;
    blockedBy: string[];
  }>;
  /** Longest incomplete dependency chain (portfolio/workspace scope). */
  criticalPath: InitiativeRef[];
  cycleDetected: boolean;
  /** Initiatives that block / are blocked by the scoped initiative (initiative scope). */
  blockedBy: InitiativeRef[];
  blocks: InitiativeRef[];
}

interface ProjectRow {
  id: number;
  initiativeId: string | null;
}

async function resolveScope(
  db: Db,
  tenantId: number,
  segmentId: string,
  scope: { kind: PmoScopeKind; id: string },
): Promise<{ name: string; initiatives: Array<{ id: string; name: string; status: string }>; projects: ProjectRow[] } | null> {
  const base = and(eq(projects.tenantId, tenantId), eq(projects.segmentId, segmentId));

  if (scope.kind === 'workspace') {
    return { name: 'Workspace', initiatives: [], projects: [] };
  }

  if (scope.kind === 'project') {
    const pid = Number(scope.id);
    if (!Number.isFinite(pid)) return null;
    const [pr] = await db
      .select({ id: projects.id, name: projects.name, initiativeId: projects.initiativeId })
      .from(projects)
      .where(and(base, eq(projects.id, pid)));
    if (!pr) return null;
    return { name: pr.name, initiatives: [], projects: [{ id: pr.id, initiativeId: pr.initiativeId }] };
  }

  if (scope.kind === 'initiative') {
    const [init] = await db
      .select({ id: initiatives.id, name: initiatives.name, status: initiatives.status })
      .from(initiatives)
      .where(and(eq(initiatives.id, scope.id), eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, segmentId)));
    if (!init) return null;
    const projRows = await db
      .select({ id: projects.id, initiativeId: projects.initiativeId })
      .from(projects)
      .where(and(base, eq(projects.initiativeId, scope.id)));
    return { name: init.name, initiatives: [init], projects: projRows };
  }

  const [pf] = await db
    .select({ name: portfolios.name })
    .from(portfolios)
    .where(and(eq(portfolios.id, scope.id), eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, segmentId)));
  if (!pf) return null;
  const inits = await db
    .select({ id: initiatives.id, name: initiatives.name, status: initiatives.status })
    .from(initiatives)
    .where(and(eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, segmentId), eq(initiatives.portfolioId, scope.id)));
  const initiativeIds = inits.map((i) => i.id);
  const projRows = initiativeIds.length
    ? await db
        .select({ id: projects.id, initiativeId: projects.initiativeId })
        .from(projects)
        .where(and(base, inArray(projects.initiativeId, initiativeIds)))
    : [];
  return { name: pf.name, initiatives: inits, projects: projRows };
}

/** Load objectives + their key results for a scope and compute progress. */
async function loadOkrs(
  db: Db,
  tenantId: number,
  segmentId: string,
  scope: { kind: PmoScopeKind; id: string },
  initiativeIds: string[],
): Promise<ObjectiveProgress[]> {
  const conds = [eq(objectives.tenantId, tenantId), eq(objectives.segmentId, segmentId)];
  const scopeFilter =
    scope.kind === 'workspace'
      // Org-level = attached to NO scope axis (a project-scoped goal belongs to its
      // project's OKR view, not the workspace bucket).
      ? and(isNull(objectives.portfolioId), isNull(objectives.initiativeId), isNull(objectives.projectId))
      : scope.kind === 'project'
        ? eq(objectives.projectId, Number(scope.id))
        : scope.kind === 'initiative'
          ? eq(objectives.initiativeId, scope.id)
          : initiativeIds.length
            ? or(eq(objectives.portfolioId, scope.id), inArray(objectives.initiativeId, initiativeIds))
            : eq(objectives.portfolioId, scope.id);
  const objRows = await db
    .select()
    .from(objectives)
    .where(and(...conds, scopeFilter));
  if (objRows.length === 0) return [];

  const objIds = objRows.map((o) => o.id);

  // Lineage links + their human labels (initiative name / task title).
  const linkRows = await db
    .select({ id: objectiveLinks.id, objectiveId: objectiveLinks.objectiveId, linkKind: objectiveLinks.linkKind, initiativeId: objectiveLinks.initiativeId, taskId: objectiveLinks.taskId })
    .from(objectiveLinks)
    .where(inArray(objectiveLinks.objectiveId, objIds));
  const linkInitIds = [...new Set(linkRows.map((l) => l.initiativeId).filter((x): x is string => !!x))];
  const linkTaskIds = [...new Set(linkRows.map((l) => l.taskId).filter((x): x is number => x != null))];
  const initNameById = new Map<string, string>(
    linkInitIds.length
      ? (await db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives).where(inArray(initiatives.id, linkInitIds))).map((r) => [r.id, r.name])
      : [],
  );
  const taskTitleById = new Map<number, string>(
    linkTaskIds.length
      ? (await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, linkTaskIds))).map((r) => [r.id, r.title])
      : [],
  );
  const linksByObjective = new Map<string, ObjectiveLinkRef[]>();
  for (const l of linkRows) {
    const ref: ObjectiveLinkRef = l.initiativeId
      ? { id: l.id, kind: 'initiative', refId: l.initiativeId, label: initNameById.get(l.initiativeId) ?? l.initiativeId }
      : { id: l.id, kind: (l.linkKind === 'epic' ? 'epic' : 'task'), refId: String(l.taskId), label: taskTitleById.get(l.taskId as number) ?? `#${l.taskId}` };
    const list = linksByObjective.get(l.objectiveId) ?? [];
    list.push(ref);
    linksByObjective.set(l.objectiveId, list);
  }

  const krRows = await db.select().from(keyResults).where(inArray(keyResults.objectiveId, objIds));
  const krByObjective = new Map<string, KeyResultProgress[]>();
  for (const kr of krRows) {
    const progress = keyResultProgress({
      metricType: kr.metricType,
      startValue: num(kr.startValue),
      targetValue: num(kr.targetValue),
      currentValue: num(kr.currentValue),
    });
    const list = krByObjective.get(kr.objectiveId) ?? [];
    list.push({
      id: kr.id,
      title: kr.title,
      metricType: kr.metricType,
      startValue: num(kr.startValue),
      targetValue: num(kr.targetValue),
      currentValue: num(kr.currentValue),
      unit: kr.unit ?? null,
      progress,
    });
    krByObjective.set(kr.objectiveId, list);
  }

  return objRows.map((o) => {
    const krs = krByObjective.get(o.id) ?? [];
    return {
      id: o.id,
      title: o.title,
      period: o.period ?? null,
      status: o.status,
      initiativeId: o.initiativeId ?? null,
      startDate: o.startDate ? new Date(o.startDate).toISOString() : null,
      endDate: o.endDate ? new Date(o.endDate).toISOString() : null,
      costClass: o.costClass ?? null,
      progress: objectiveProgress(krs.map((k) => k.progress)),
      keyResults: krs,
      links: linksByObjective.get(o.id) ?? [],
    };
  });
}

/**
 * Compose the full PMO rollup for a portfolio, initiative, project, or workspace.
 * Returns null when the scope entity doesn't exist for this tenant.
 */
export async function computePortfolioRollup(
  db: Db,
  tenantId: number,
  segmentId: string,
  scope: { kind: PmoScopeKind; id: string },
  opts: { now: number; doraDays?: number },
): Promise<PmoRollup | null> {
  const resolved = await resolveScope(db, tenantId, segmentId, scope);
  if (!resolved) return null;

  const now = opts.now;
  const doraDays = opts.doraDays ?? DEFAULT_DORA_DAYS;
  const projectRows = resolved.projects;
  const projectIds = projectRows.map((p) => p.id);
  const initiativeIds = resolved.initiatives.map((i) => i.id);

  // ── delivery (tasks lifecycle) ──────────────────────────────────────────────
  const taskRows = projectIds.length
    ? await db
        .select({ projectId: tasks.projectId, createdAt: tasks.createdAt, completedAt: tasks.completedAt })
        .from(tasks)
        .where(inArray(tasks.projectId, projectIds))
    : [];
  const completed = taskRows.filter((t) => t.completedAt != null);
  const cycleHrs = completed
    .map((t) => (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()) / HOUR_MS)
    .filter((h) => h >= 0);
  const avgCycleTimeHours = cycleHrs.length ? cycleHrs.reduce((a, b) => a + b, 0) / cycleHrs.length : 0;
  const throughputPerWeek = completed.filter((t) => now - new Date(t.completedAt!).getTime() <= WEEK_MS).length;

  // ── spend (per-project LLM cost, grouped so byInitiative can reuse it) ──────
  const llmByProject = projectIds.length
    ? await db
        .select({
          projectId: llmUsageLog.projectId,
          millicents: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)`,
        })
        .from(llmUsageLog)
        .where(and(eq(llmUsageLog.tenantId, tenantId), inArray(llmUsageLog.projectId, projectIds)))
        .groupBy(llmUsageLog.projectId)
    : [];
  const costUsdByProject = new Map<number, number>(
    llmByProject
      .filter((r) => r.projectId != null)
      .map((r) => [r.projectId as number, num(r.millicents) / MILLICENTS_PER_USD]),
  );
  const agentLlmCostUsd = [...costUsdByProject.values()].reduce((a, b) => a + b, 0);

  // ── DORA (reuse the pure rollup; lead time from completed-task cycle) ───────
  const since = new Date(now - doraDays * 24 * HOUR_MS);
  const deploys: DeployRow[] = projectIds.length
    ? ((await db
        .select({ deployedAt: deploymentEvents.deployedAt, isFailure: deploymentEvents.isFailure, restoredAt: deploymentEvents.restoredAt })
        .from(deploymentEvents)
        .where(and(
          eq(deploymentEvents.tenantId, tenantId),
          inArray(deploymentEvents.projectId, projectIds),
          gte(deploymentEvents.deployedAt, since),
        ))) as DeployRow[])
    : [];
  const leadTimes = completed
    .filter((t) => now - new Date(t.completedAt!).getTime() <= doraDays * 24 * HOUR_MS)
    .map((t) => (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()) / HOUR_MS)
    .filter((h) => h >= 0);
  const dora = rollupDora(doraDays, leadTimes, deploys);

  // ── outcomes (run_model_outcomes: did the AI approach actually ship?) ───────
  const [outcomeAgg] = projectIds.length
    ? await db
        .select({
          runs: sql<string>`count(*)`,
          avgScore: sql<string>`coalesce(avg(${runModelOutcomes.score}),0)`,
          merged: sql<string>`coalesce(sum(case when ${runModelOutcomes.merged} then 1 else 0 end),0)`,
        })
        .from(runModelOutcomes)
        .where(and(eq(runModelOutcomes.tenantId, tenantId), inArray(runModelOutcomes.projectId, projectIds)))
    : [{ runs: '0', avgScore: '0', merged: '0' }];
  const runs = num(outcomeAgg?.runs);
  const outcomes = {
    runs,
    avgScore: num(outcomeAgg?.avgScore),
    mergedRatePct: runs > 0 ? (num(outcomeAgg?.merged) / runs) * 100 : null,
  };

  // ── OKR ─────────────────────────────────────────────────────────────────────
  const okrObjectives = await loadOkrs(db, tenantId, segmentId, scope, initiativeIds);
  const okrAvg = okrObjectives.length
    ? okrObjectives.reduce((a, o) => a + o.progress, 0) / okrObjectives.length
    : 0;

  // ── dependencies / critical path ────────────────────────────────────────────
  // Load the tenant/segment initiative graph once; resolve names for any edge
  // endpoint (a blocker may live outside the scoped set).
  const [allInits, allEdges] = await Promise.all([
    db.select({ id: initiatives.id, name: initiatives.name, status: initiatives.status })
      .from(initiatives)
      .where(and(eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, segmentId))),
    db.select({ fromInitiativeId: pmoDependencies.fromInitiativeId, toInitiativeId: pmoDependencies.toInitiativeId })
      .from(pmoDependencies)
      .where(and(eq(pmoDependencies.tenantId, tenantId), eq(pmoDependencies.segmentId, segmentId))),
  ]);
  const initMeta = new Map(allInits.map((i) => [i.id, i]));
  const ref = (id: string): InitiativeRef => {
    const m = initMeta.get(id);
    return { initiativeId: id, name: m?.name ?? id, status: m?.status ?? 'unknown' };
  };

  // Analysis over the scoped initiative set (portfolio = its initiatives,
  // initiative = just itself); edges are filtered to that set for the path.
  const scopedIds = new Set(initiativeIds.length ? initiativeIds : scope.kind === 'initiative' ? [scope.id] : []);
  const scopedEdges = allEdges.filter((e) => scopedIds.has(e.fromInitiativeId) && scopedIds.has(e.toInitiativeId));
  const scopedInits = [...scopedIds].map(ref).map((r) => ({ id: r.initiativeId, name: r.name, status: r.status }));
  const analysis = computeDependencyAnalysis(scopedInits, scopedEdges);

  // initiative-scope: surface direct blockers/blocks across the whole graph.
  let blockedBy: InitiativeRef[] = [];
  let blocks: InitiativeRef[] = [];
  if (scope.kind === 'initiative') {
    blockedBy = allEdges.filter((e) => e.toInitiativeId === scope.id).map((e) => ref(e.fromInitiativeId));
    blocks = allEdges.filter((e) => e.fromInitiativeId === scope.id).map((e) => ref(e.toInitiativeId));
  }

  // ── byInitiative breakdown (portfolio scope) ────────────────────────────────
  let byInitiative: PmoRollup['byInitiative'] = [];
  if (scope.kind === 'portfolio' && resolved.initiatives.length) {
    const projectInitiative = new Map<number, string | null>(projectRows.map((p) => [p.id, p.initiativeId]));
    const completedByInitiative = new Map<string, number>();
    for (const t of completed) {
      const initId = projectInitiative.get(t.projectId);
      if (initId) completedByInitiative.set(initId, (completedByInitiative.get(initId) ?? 0) + 1);
    }
    const costByInitiative = new Map<string, number>();
    for (const [pid, usd] of costUsdByProject) {
      const initId = projectInitiative.get(pid);
      if (initId) costByInitiative.set(initId, (costByInitiative.get(initId) ?? 0) + usd);
    }
    const projectCountByInitiative = new Map<string, number>();
    for (const p of projectRows) {
      if (p.initiativeId) projectCountByInitiative.set(p.initiativeId, (projectCountByInitiative.get(p.initiativeId) ?? 0) + 1);
    }
    const progressByInitiative = new Map<string, number[]>();
    for (const o of okrObjectives) {
      if (o.initiativeId) {
        const list = progressByInitiative.get(o.initiativeId) ?? [];
        list.push(o.progress);
        progressByInitiative.set(o.initiativeId, list);
      }
    }
    byInitiative = resolved.initiatives.map((i) => {
      const progresses = progressByInitiative.get(i.id) ?? [];
      const blockers = (analysis.blockedBy[i.id] ?? []);
      const isBlocked = blockers.some((bid) => isIncompleteStatus(initMeta.get(bid)?.status));
      return {
        initiativeId: i.id,
        name: i.name,
        status: i.status,
        projectCount: projectCountByInitiative.get(i.id) ?? 0,
        completedCount: completedByInitiative.get(i.id) ?? 0,
        agentLlmCostUsd: costByInitiative.get(i.id) ?? 0,
        avgProgress: progresses.length ? progresses.reduce((a, b) => a + b, 0) / progresses.length : 0,
        isBlocked,
        blockedBy: blockers,
      };
    });
  }

  return {
    scope: { kind: scope.kind, id: scope.id, name: resolved.name },
    projectCount: projectIds.length,
    initiativeCount: scope.kind === 'portfolio' ? resolved.initiatives.length : 0,
    delivery: {
      totalTasks: taskRows.length,
      completedCount: completed.length,
      openCount: taskRows.length - completed.length,
      avgCycleTimeHours,
      throughputPerWeek,
    },
    spend: { agentLlmCostUsd },
    dora,
    outcomes,
    okr: { objectives: okrObjectives, avgProgress: okrAvg },
    byInitiative,
    criticalPath: analysis.criticalPath.map(ref),
    cycleDetected: analysis.cycleDetected,
    blockedBy,
    blocks,
  };
}

// ── Tree (management view: portfolios ▸ initiatives ▸ linked projects) ────────

export interface PmoTree {
  portfolios: Array<{ id: string; name: string; description: string | null; status: string; targetDate: string | null }>;
  initiatives: Array<{ id: string; name: string; description: string | null; status: string; portfolioId: string | null; targetDate: string | null; projectCount: number }>;
  projects: Array<{ id: number; name: string; key: string; status: string; initiativeId: string | null }>;
  dependencies: Array<{ id: string; fromInitiativeId: string; toInitiativeId: string }>;
}

/** Flat lists for the structure/management UI (assembled into a tree client-side). */
export async function loadPmoTree(db: Db, tenantId: number, segmentId: string): Promise<PmoTree> {
  const [pfRows, initRows, projRows, depRows] = await Promise.all([
    db
      .select({ id: portfolios.id, name: portfolios.name, description: portfolios.description, status: portfolios.status, targetDate: portfolios.targetDate })
      .from(portfolios)
      .where(and(eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, segmentId))),
    db
      .select({ id: initiatives.id, name: initiatives.name, description: initiatives.description, status: initiatives.status, portfolioId: initiatives.portfolioId, targetDate: initiatives.targetDate })
      .from(initiatives)
      .where(and(eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, segmentId))),
    db
      .select({ id: projects.id, name: projects.name, key: projects.key, status: projects.status, initiativeId: projects.initiativeId })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.segmentId, segmentId))),
    db
      .select({ id: pmoDependencies.id, fromInitiativeId: pmoDependencies.fromInitiativeId, toInitiativeId: pmoDependencies.toInitiativeId })
      .from(pmoDependencies)
      .where(and(eq(pmoDependencies.tenantId, tenantId), eq(pmoDependencies.segmentId, segmentId))),
  ]);

  const projectCountByInitiative = new Map<string, number>();
  for (const p of projRows) {
    if (p.initiativeId) projectCountByInitiative.set(p.initiativeId, (projectCountByInitiative.get(p.initiativeId) ?? 0) + 1);
  }

  return {
    portfolios: pfRows.map((p) => ({ ...p, targetDate: p.targetDate ? new Date(p.targetDate).toISOString() : null })),
    initiatives: initRows.map((i) => ({
      ...i,
      portfolioId: i.portfolioId ?? null,
      targetDate: i.targetDate ? new Date(i.targetDate).toISOString() : null,
      projectCount: projectCountByInitiative.get(i.id) ?? 0,
    })),
    projects: projRows.map((p) => ({ id: p.id, name: p.name, key: p.key, status: p.status, initiativeId: p.initiativeId ?? null })),
    dependencies: depRows,
  };
}

/**
 * Would adding edge from→to close a cycle (i.e. is `from` already reachable from
 * `to`)? Used by the route to reject cycle-creating dependency edges. Pure.
 */
export function wouldCreateCycle(edges: DepEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.fromInitiativeId) ?? [];
    list.push(e.toInitiativeId);
    adj.set(e.fromInitiativeId, list);
  }
  // DFS from `to`; if we reach `from`, the new edge from→to would form a cycle.
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of adj.get(cur) ?? []) stack.push(n);
  }
  return false;
}

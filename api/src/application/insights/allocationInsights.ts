/**
 * Allocation lens — categorical investment of engineering effort (EMP-1) + the
 * capitalizable vs non-capitalizable cost split that rides the same axis (EMP-18).
 *
 * Jellyfish's signature view: not "how many issues" but "where did the TIME go".
 * We measure effort in TIME (not issue counts) from signals already collected —
 * the task lifecycle timestamps + status-transition log — and attribute each
 * task's effort-hours to its investment {@link AllocationCategory}, at tenant /
 * team / project / individual grain. The category is the stored override if a PM
 * set one, else DERIVED on the fly ({@link deriveAllocationCategory}) so every
 * historical task counts with zero backfill.
 *
 * Cost: per-task LLM spend (llm_usage_log.cost_usd_millicents) is split capex/opex
 * by the task's cost_class (0225), defaulting from the category when unclassified
 * ({@link defaultCostClassFor}) — so capitalizable cost is meaningful immediately
 * and a PM override still wins.
 *
 * The aggregation ({@link summarizeAllocation}) is a pure function over fetched
 * rows so it is unit-testable without a DB; the route caches it and merges goals.
 */

import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentHosts,
  llmUsageLog,
  projects,
  tasks,
  users,
} from '../../infrastructure/database/schema';
import { identityOf, type MemberIdentityFields } from '../metrics/workforceMetrics';
import { notSystemTask } from '../task/taskScope';
import {
  ALLOCATION_CATEGORIES,
  allocationCategoryLabel,
  defaultCostClassFor,
  deriveAllocationCategory,
  normalizeAllocationCategory,
  type AllocationCategory,
} from '../llm/allocationCategories';
import { loadTaskCostClassMap } from '../pmo/planningSpine';
import { MILLICENTS_PER_USD } from '../../domain/shared/money';

const HOUR_MS = 3_600_000;
/** Bound on tasks scanned per window (mirrors workforceMetrics.MAX_METRIC_ROWS). */
const MAX_METRIC_ROWS = 5_000;
/** Cap per-task effort hours so a single long-lived/stale task can't dominate the
 *  mix (30 days). Effort here is a signal-derived estimate, not a timesheet. */
const MAX_TASK_HOURS = 24 * 30;
/** Working hours that make up one full-time-equivalent month — the unit the
 *  cost-report donut/history present (≈ a 40h week × 4 weeks). Effort-hours / this
 *  = FTE-months, the capitalization-report grain (mirrors Jellyfish "FTE-months"). */
export const WORKING_HOURS_PER_FTE_MONTH = 160;
/** Max epics returned in the capitalization browser (bounded result set). */
const MAX_EPICS = 400;

/** Effort-hours → FTE-months (the capitalization-report unit). */
export function fteMonthsFromHours(hours: number): number {
  return hours / WORKING_HOURS_PER_FTE_MONTH;
}

export interface AllocationTaskRow extends MemberIdentityFields {
  taskId: number;
  title: string | null;
  description: string | null;
  source: string | null;
  actionType: string | null;
  allocationCategory: string | null;
  costClass: string | null;
  costClassSource: string | null;
  taskType: string | null;
  parentTaskId: number | null;
  projectId: number;
  projectName: string | null;
  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

/**
 * Capitalization status for the cost report (Jellyfish "Capitalized / Not
 * Capitalized / Uncategorized"). Distinct from {@link effectiveCostClass}, which
 * is GAAP-conservative and never returns "unknown": a third *uncategorized* slice
 * is surfaced when the work carries NO classification signal at all (no own
 * cost_class, no lineage inheritance, no allocation override, and no derivable
 * category) — i.e. work a finance reviewer must still triage.
 */
export type CapitalizationStatus = 'capitalized' | 'not_capitalized' | 'uncategorized';
export const CAPITALIZATION_STATUSES: CapitalizationStatus[] = ['capitalized', 'not_capitalized', 'uncategorized'];

export function capitalizationStatus(r: AllocationTaskRow, lineage?: Map<number, 'capex' | 'opex'>): CapitalizationStatus {
  if (r.costClass === 'capex') return 'capitalized';
  if (r.costClass === 'opex') return 'not_capitalized';
  const inherited = lineage?.get(r.taskId);
  if (inherited) return inherited === 'capex' ? 'capitalized' : 'not_capitalized';
  // No own/lineage classification: genuinely untriaged when nothing yields a
  // category either (no override AND signals derive only to the catch-all "other").
  if (!r.allocationCategory && deriveAllocationCategory(r) === 'other') return 'uncategorized';
  return defaultCostClassFor(effectiveCategory(r)) === 'capex' ? 'capitalized' : 'not_capitalized';
}

/** Where an item's capitalization status came from — for the epic browser. */
export type CapitalizationSource = 'manual' | 'inherited' | 'derived';
export function capitalizationSource(r: AllocationTaskRow, lineage?: Map<number, 'capex' | 'opex'>): CapitalizationSource {
  if (r.costClass === 'capex' || r.costClass === 'opex') return 'manual';
  if (lineage?.get(r.taskId)) return 'inherited';
  return 'derived';
}

/** Estimated active effort-hours for a task: cycle time for completed work, else
 *  age-to-now for in-flight work, clamped to [0, MAX_TASK_HOURS]. */
export function taskEffortHours(r: AllocationTaskRow, now: number): number {
  const end = r.completedAt ? r.completedAt.getTime() : Math.min(now, r.updatedAt.getTime());
  const hrs = (end - r.createdAt.getTime()) / HOUR_MS;
  return Math.max(0, Math.min(MAX_TASK_HOURS, hrs));
}

/** The task's effective investment category — stored override wins, else derived. */
export function effectiveCategory(r: AllocationTaskRow): AllocationCategory {
  return r.allocationCategory
    ? normalizeAllocationCategory(r.allocationCategory)
    : deriveAllocationCategory(r);
}

/** The task's effective capex/opex class — stored cost_class wins, else the
 *  lineage-inherited class from its objective/initiative (when a `lineage` map is
 *  supplied — closes SPINE-2), else the category default (GAAP-conservative: only
 *  innovation capitalizes). */
export function effectiveCostClass(r: AllocationTaskRow, lineage?: Map<number, 'capex' | 'opex'>): 'capex' | 'opex' {
  if (r.costClass === 'capex' || r.costClass === 'opex') return r.costClass;
  const inherited = lineage?.get(r.taskId);
  if (inherited) return inherited;
  return defaultCostClassFor(effectiveCategory(r));
}

export interface CategoryAllocation {
  category: AllocationCategory;
  label: string;
  hours: number;
  pct: number;          // share of total effort hours, 0..100
  taskCount: number;
  costUsd: number;      // attributed LLM spend
  capexUsd: number;
  opexUsd: number;
  /** Goal target for this category in this scope/period, if set (EMP-2). */
  targetPct?: number;
  /** actual pct − target pct (signed); only present when a target is set. */
  variancePct?: number;
}

export interface MemberAllocation {
  memberKind: string;
  memberRef: string;
  memberName: string;
  totalHours: number;
  /** Category → hours for this member (the individual-grain breakdown). */
  byCategory: Array<{ category: AllocationCategory; label: string; hours: number; pct: number }>;
  /** Number of DISTINCT categories this member touched — a "spread too thin"
   *  hint at the investment level (pairs with EMP-12 project-breadth). */
  categorySpread: number;
}

/** One slice of the capitalization donut (effort + cost for a status). */
export interface StatusBucket {
  hours: number;
  fteMonths: number;
  costUsd: number;
  taskCount: number;
}
function emptyStatusBucket(): StatusBucket {
  return { hours: 0, fteMonths: 0, costUsd: 0, taskCount: 0 };
}

/** An epic in the capitalization browser (Jellyfish "Work Capitalization" tab). */
export interface EpicCapitalization {
  epicId: number;
  title: string;
  status: CapitalizationStatus;
  source: CapitalizationSource;
  hours: number;
  fteMonths: number;
  costUsd: number;
  /** Tasks rolled into this epic (the epic itself + its child tasks in window). */
  taskCount: number;
  projectName: string | null;
}

export interface AllocationInsights {
  windowDays: number;
  totals: {
    hours: number;
    taskCount: number;
    costUsd: number;
    capexUsd: number;
    opexUsd: number;
    /** capex / (capex + opex) × 100 — the capitalizable share of spend (EMP-18). */
    capitalizablePct: number;
    /** Capitalized / Not Capitalized / Uncategorized split by effort + cost — the
     *  cost-report donut (FTE | Cost toggle). */
    byStatus: Record<CapitalizationStatus, StatusBucket>;
  };
  byCategory: CategoryAllocation[];
  byMember: MemberAllocation[];
  /** Epics with their capitalization status + effort/cost — the browser table. */
  epics: EpicCapitalization[];
}

/** Per-(category) goal targets for the active scope/period — category → target %. */
export type AllocationGoalMap = Map<AllocationCategory, number>;

/**
 * Pure: turn fetched task rows + per-task cost into the allocation rollup. Costs
 * are passed as a taskId → millicents map so the function stays DB-free.
 */
export function summarizeAllocation(
  rows: AllocationTaskRow[],
  costByTask: Map<number, number>,
  windowDays: number,
  now: number,
  goals: AllocationGoalMap = new Map(),
  /** task id → lineage-resolved CAPEX/OPEX (closes SPINE-2; omit = category default). */
  lineage?: Map<number, 'capex' | 'opex'>,
): AllocationInsights {
  const cat = (c: AllocationCategory) => ({
    category: c, label: allocationCategoryLabel(c),
    hours: 0, pct: 0, taskCount: 0, costUsd: 0, capexUsd: 0, opexUsd: 0,
  } as CategoryAllocation);
  const byCat = new Map<AllocationCategory, CategoryAllocation>(
    ALLOCATION_CATEGORIES.map((c) => [c, cat(c)]),
  );

  const memberAgg = new Map<string, {
    kind: string; ref: string; name: string; total: number; cats: Map<AllocationCategory, number>;
  }>();

  // Capitalization-status split (cost-report donut) + epic rollup (browser). The
  // epic set is every taskType='epic' row; a non-epic task rolls into its epic
  // parent (parentTaskId) when that parent is in window.
  const byStatus: Record<CapitalizationStatus, StatusBucket> = {
    capitalized: emptyStatusBucket(), not_capitalized: emptyStatusBucket(), uncategorized: emptyStatusBucket(),
  };
  const epicAgg = new Map<number, EpicCapitalization>();
  for (const r of rows) {
    if (r.taskType !== 'epic') continue;
    epicAgg.set(r.taskId, {
      epicId: r.taskId,
      title: r.title ?? `#${r.taskId}`,
      status: capitalizationStatus(r, lineage),
      source: capitalizationSource(r, lineage),
      hours: 0, fteMonths: 0, costUsd: 0, taskCount: 0,
      projectName: r.projectName ?? null,
    });
  }

  let totalHours = 0, totalCost = 0, capex = 0, opex = 0;

  for (const r of rows) {
    const c = effectiveCategory(r);
    const hrs = taskEffortHours(r, now);
    const costUsd = (costByTask.get(r.taskId) ?? 0) / MILLICENTS_PER_USD;
    const klass = effectiveCostClass(r, lineage);

    const bucket = byCat.get(c)!;
    bucket.hours += hrs;
    bucket.taskCount += 1;
    bucket.costUsd += costUsd;
    if (klass === 'capex') bucket.capexUsd += costUsd; else bucket.opexUsd += costUsd;

    const sb = byStatus[capitalizationStatus(r, lineage)];
    sb.hours += hrs; sb.costUsd += costUsd; sb.taskCount += 1;

    const epicId = r.taskType === 'epic' ? r.taskId
      : (r.parentTaskId != null && epicAgg.has(r.parentTaskId) ? r.parentTaskId : null);
    if (epicId != null) {
      const e = epicAgg.get(epicId)!;
      e.hours += hrs; e.costUsd += costUsd; e.taskCount += 1;
    }

    totalHours += hrs;
    totalCost += costUsd;
    if (klass === 'capex') capex += costUsd; else opex += costUsd;

    const id = identityOf(r);
    if (id) {
      const key = `${id.kind}:${id.ref}`;
      const m = memberAgg.get(key) ?? { kind: id.kind, ref: id.ref, name: id.name, total: 0, cats: new Map() };
      m.total += hrs;
      m.cats.set(c, (m.cats.get(c) ?? 0) + hrs);
      memberAgg.set(key, m);
    }
  }

  const pctOf = (h: number) => (totalHours > 0 ? (h / totalHours) * 100 : 0);
  const byCategory = ALLOCATION_CATEGORIES.map((c) => {
    const b = byCat.get(c)!;
    b.pct = pctOf(b.hours);
    const target = goals.get(c);
    if (target != null) { b.targetPct = target; b.variancePct = b.pct - target; }
    return b;
  }).sort((a, b) => b.hours - a.hours);

  const byMember: MemberAllocation[] = [...memberAgg.values()]
    .map((m) => ({
      memberKind: m.kind,
      memberRef: m.ref,
      memberName: m.name,
      totalHours: m.total,
      categorySpread: m.cats.size,
      byCategory: [...m.cats.entries()]
        .map(([c, h]) => ({ category: c, label: allocationCategoryLabel(c), hours: h, pct: m.total > 0 ? (h / m.total) * 100 : 0 }))
        .sort((a, b) => b.hours - a.hours),
    }))
    .sort((a, b) => b.totalHours - a.totalHours);

  for (const s of CAPITALIZATION_STATUSES) byStatus[s].fteMonths = fteMonthsFromHours(byStatus[s].hours);

  const epics = [...epicAgg.values()]
    .map((e) => ({ ...e, fteMonths: fteMonthsFromHours(e.hours) }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, MAX_EPICS);

  return {
    windowDays,
    totals: {
      hours: totalHours,
      taskCount: rows.length,
      costUsd: totalCost,
      capexUsd: capex,
      opexUsd: opex,
      capitalizablePct: capex + opex > 0 ? (capex / (capex + opex)) * 100 : 0,
      byStatus,
    },
    byCategory,
    byMember,
    epics,
  };
}

export interface AllocationScope {
  projectId?: number;
  /** Restrict to tasks owned by these members (kind:ref) — the team grain. */
  memberKeys?: Set<string>;
}

/**
 * Fetch + roll up allocation for a tenant over `days`. Tasks carry no tenant_id,
 * so scope by joining projects (same pattern as workforceMetrics). `scope` narrows
 * to a project and/or a team's members; `goals` is merged in by the route.
 */
export async function computeAllocationInsights(
  db: Db,
  tenantId: number,
  days: number,
  now: number,
  scope: AllocationScope = {},
  goals: AllocationGoalMap = new Map(),
  /** When `lineage` is true, resolve CAPEX/OPEX through the planning-spine lineage
   *  (objective/initiative inheritance) instead of only own-or-category (SPINE-2).
   *  Off by default so finance aggregates keep the cheap category-default behaviour. */
  opts: { lineage?: boolean } = {},
): Promise<AllocationInsights> {
  const since = new Date(now - days * 24 * HOUR_MS);

  const where = [
    eq(projects.tenantId, tenantId),
    eq(tasks.archived, false),
    gte(tasks.updatedAt, since),
    notSystemTask,
  ];
  if (scope.projectId != null) where.push(eq(tasks.projectId, scope.projectId));

  const rows = (await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      description: tasks.description,
      source: tasks.source,
      actionType: tasks.actionType,
      allocationCategory: tasks.allocationCategory,
      costClass: tasks.costClass,
      costClassSource: tasks.costClassSource,
      taskType: tasks.taskType,
      parentTaskId: tasks.parentTaskId,
      projectId: tasks.projectId,
      projectName: projects.name,
      assignedUserId: tasks.assignedUserId,
      assignedUserName: users.displayName,
      assignedAgentHostId: tasks.assignedAgentHostId,
      assignedHostName: agentHosts.name,
      assignedAgentRef: tasks.assignedAgentRef,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assignedUserId))
    .leftJoin(agentHosts, eq(agentHosts.id, tasks.assignedAgentHostId))
    .where(and(...where))
    .orderBy(tasks.updatedAt)
    .limit(MAX_METRIC_ROWS)) as AllocationTaskRow[];

  const scoped = scope.memberKeys
    ? rows.filter((r) => { const id = identityOf(r); return id != null && scope.memberKeys!.has(`${id.kind}:${id.ref}`); })
    : rows;

  // Per-task LLM cost over the same window (attributed spend → capex/opex split).
  const taskIds = scoped.map((r) => r.taskId);
  const costByTask = new Map<number, number>();
  if (taskIds.length) {
    const costRows = await db
      .select({ taskId: llmUsageLog.taskId, cost: llmUsageLog.costUsdMillicents })
      .from(llmUsageLog)
      .where(and(
        eq(llmUsageLog.tenantId, tenantId),
        isNotNull(llmUsageLog.taskId),
        inArray(llmUsageLog.taskId, taskIds),
        gte(llmUsageLog.createdAt, since),
      ));
    for (const c of costRows) {
      if (c.taskId != null) costByTask.set(c.taskId, (costByTask.get(c.taskId) ?? 0) + (c.cost ?? 0));
    }
  }

  const lineage = opts.lineage ? await loadTaskCostClassMap(db, tenantId) : undefined;
  return summarizeAllocation(scoped, costByTask, days, now, goals, lineage);
}

// ── Historical months (cost-report time series) ──────────────────────────────

/** One month in the capitalization history (Jellyfish "Historical Months"). */
export interface AllocationHistoryMonth {
  month: string;                 // 'YYYY-MM'
  status: 'ready' | 'in_progress';
  capitalizedFteMonths: number;
  totalFteMonths: number;
  capitalizedUsd: number;
  notCapitalizedUsd: number;
  uncategorizedUsd: number;
  totalUsd: number;
  taskCount: number;
}
export interface AllocationHistory {
  months: AllocationHistoryMonth[];   // newest first
  dataAsOf: string;                    // ISO timestamp of the snapshot
}

/** UTC 'YYYY-MM' for a date. */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The last `months` calendar-month keys, oldest → newest, ending at `now`. */
function recentMonthKeys(now: number, months: number): string[] {
  const out: string[] = [];
  const d = new Date(now);
  let y = d.getUTCFullYear(), m = d.getUTCMonth(); // 0-based
  for (let i = 0; i < months; i++) {
    out.unshift(`${y}-${String(m + 1).padStart(2, '0')}`);
    if (--m < 0) { m = 11; y -= 1; }
  }
  return out;
}

/**
 * Pure: bucket task effort + cost into the month each task last moved
 * (completedAt, else updatedAt) and split by {@link capitalizationStatus}. Cost is
 * the task's total LLM spend over the range, attributed to that same month — a
 * faithful, single-fetch approximation for the report's monthly trend.
 */
export function summarizeAllocationHistory(
  rows: AllocationTaskRow[],
  costByTask: Map<number, number>,
  months: number,
  now: number,
  lineage?: Map<number, 'capex' | 'opex'>,
): AllocationHistory {
  const keys = recentMonthKeys(now, months);
  const allowed = new Set(keys);
  const current = monthKey(new Date(now));
  const blank = (): AllocationHistoryMonth => ({
    month: '', status: 'ready',
    capitalizedFteMonths: 0, totalFteMonths: 0,
    capitalizedUsd: 0, notCapitalizedUsd: 0, uncategorizedUsd: 0, totalUsd: 0, taskCount: 0,
  });
  const byMonth = new Map<string, AllocationHistoryMonth>(keys.map((k) => [k, { ...blank(), month: k, status: k === current ? 'in_progress' : 'ready' }]));

  for (const r of rows) {
    const when = r.completedAt ?? r.updatedAt;
    const key = monthKey(new Date(when));
    if (!allowed.has(key)) continue;
    const bucket = byMonth.get(key)!;
    const hrs = taskEffortHours(r, now);
    const costUsd = (costByTask.get(r.taskId) ?? 0) / MILLICENTS_PER_USD;
    const status = capitalizationStatus(r, lineage);
    const fte = fteMonthsFromHours(hrs);
    bucket.totalFteMonths += fte;
    bucket.totalUsd += costUsd;
    bucket.taskCount += 1;
    if (status === 'capitalized') { bucket.capitalizedFteMonths += fte; bucket.capitalizedUsd += costUsd; }
    else if (status === 'not_capitalized') bucket.notCapitalizedUsd += costUsd;
    else bucket.uncategorizedUsd += costUsd;
  }

  return { months: keys.map((k) => byMonth.get(k)!).reverse(), dataAsOf: new Date(now).toISOString() };
}

/**
 * Fetch + roll up the capitalization history for a tenant over `months` calendar
 * months. Mirrors {@link computeAllocationInsights}' scoping; lineage honours the
 * planning-spine inheritance so figures agree with the live donut.
 */
export async function computeAllocationHistory(
  db: Db,
  tenantId: number,
  months: number,
  now: number,
  scope: AllocationScope = {},
  opts: { lineage?: boolean } = {},
): Promise<AllocationHistory> {
  // Window back to the first day of the oldest month in range.
  const keys = recentMonthKeys(now, months);
  const oldest = keys[0]!;
  const since = new Date(Date.UTC(Number(oldest.slice(0, 4)), Number(oldest.slice(5, 7)) - 1, 1));

  const where = [
    eq(projects.tenantId, tenantId),
    eq(tasks.archived, false),
    gte(tasks.updatedAt, since),
    notSystemTask,
  ];
  if (scope.projectId != null) where.push(eq(tasks.projectId, scope.projectId));

  const rows = (await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      description: tasks.description,
      source: tasks.source,
      actionType: tasks.actionType,
      allocationCategory: tasks.allocationCategory,
      costClass: tasks.costClass,
      costClassSource: tasks.costClassSource,
      taskType: tasks.taskType,
      parentTaskId: tasks.parentTaskId,
      projectId: tasks.projectId,
      projectName: projects.name,
      assignedUserId: tasks.assignedUserId,
      assignedUserName: users.displayName,
      assignedAgentHostId: tasks.assignedAgentHostId,
      assignedHostName: agentHosts.name,
      assignedAgentRef: tasks.assignedAgentRef,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assignedUserId))
    .leftJoin(agentHosts, eq(agentHosts.id, tasks.assignedAgentHostId))
    .where(and(...where))
    .orderBy(tasks.updatedAt)
    .limit(MAX_METRIC_ROWS)) as AllocationTaskRow[];

  const scoped = scope.memberKeys
    ? rows.filter((r) => { const id = identityOf(r); return id != null && scope.memberKeys!.has(`${id.kind}:${id.ref}`); })
    : rows;

  const taskIds = scoped.map((r) => r.taskId);
  const costByTask = new Map<number, number>();
  if (taskIds.length) {
    const costRows = await db
      .select({ taskId: llmUsageLog.taskId, cost: llmUsageLog.costUsdMillicents })
      .from(llmUsageLog)
      .where(and(
        eq(llmUsageLog.tenantId, tenantId),
        isNotNull(llmUsageLog.taskId),
        inArray(llmUsageLog.taskId, taskIds),
        gte(llmUsageLog.createdAt, since),
      ));
    for (const cr of costRows) {
      if (cr.taskId != null) costByTask.set(cr.taskId, (costByTask.get(cr.taskId) ?? 0) + (cr.cost ?? 0));
    }
  }

  const lineage = opts.lineage ? await loadTaskCostClassMap(db, tenantId) : undefined;
  return summarizeAllocationHistory(scoped, costByTask, months, now, lineage);
}

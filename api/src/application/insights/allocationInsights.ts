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

import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentHosts,
  llmUsageLog,
  memberProfiles,
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
import { taskEffortHours as sharedTaskEffortHours } from '../metrics/effortHours';
import { loggedMinutesByTask, isoDay } from '../timeTracking/timeTracking';

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

/**
 * Effort-hours for a task in the ALLOCATION mix: real logged time when any was
 * recorded, else cycle time for completed work / age-to-now for in-flight work,
 * clamped to [0, MAX_TASK_HOURS].
 *
 * `loggedMinutes` is the correction that closes AIIMP-5. This function used to be
 * a pure cycle-time estimate that never consulted `time_entries`, so the numbers
 * built on top of it — the investment mix, the capitalization report's FTE-months
 * and the R&D tax-credit QRE base — were derived from ticket open/close times even
 * on tenants who had logged every hour. It is now the SAME rule labour
 * attribution uses ({@link taskEffort}), parameterised for this caller's cap and
 * for counting work in flight.
 */
export function taskEffortHours(r: AllocationTaskRow, now: number, loggedMinutes = 0): number {
  return sharedTaskEffortHours(
    { loggedMinutes, createdAt: r.createdAt, completedAt: r.completedAt, updatedAt: r.updatedAt },
    { capHours: MAX_TASK_HOURS, includeInFlight: true, now },
  );
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
  /** Effort priced at each member's OWN modelled rate — real labour dollars, not
   *  a workspace blended rate applied to everyone. 0 when no rates are set. */
  laborUsd: number;
  /**
   * Of `hours`, how many belong to a member who HAS a modelled rate — i.e. the
   * hours `laborUsd` actually prices.
   *
   * Carried explicitly rather than inferred from `laborUsd / hours`, because the
   * one consumer that needs it (the R&D credit's blended-rate fallback) needs the
   * hours the tenant has NO compensation data for, and dividing dollars by an
   * unknown blend of rates cannot recover that. `hours - ratedHours` can.
   */
  ratedHours: number;
  /** Of `hours`, the share that came from RECORDED time (`time_entries`) rather
   *  than a cycle-time estimate. Lets a report state how much of it was measured. */
  loggedHours: number;
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
  /**
   * Real labour dollars — effort priced at each member's OWN modelled rate, not a
   * workspace-wide blended guess. 0 when no member on the slice has a rate set.
   */
  laborUsd: number;
  /** Of `hours`, those belonging to a member with a modelled rate. */
  ratedHours: number;
  /** Of `hours`, how many came from RECORDED time rather than a cycle-time
   *  estimate. A capitalization figure carried into an accounting system needs to
   *  state how much of it was measured; this is that number. */
  loggedHours: number;
}
function emptyStatusBucket(): StatusBucket {
  return { hours: 0, fteMonths: 0, costUsd: 0, taskCount: 0, laborUsd: 0, ratedHours: 0, loggedHours: 0 };
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
  /** Effort priced at each member's own rate (0 when no rate is modelled). */
  laborUsd: number;
  /** Of `hours`, those belonging to a member with a modelled rate. */
  ratedHours: number;
  /** Of `hours`, the share that came from recorded time rather than an estimate. */
  loggedHours: number;
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
    /**
     * Effort priced at each member's OWN rate (`member_profiles.cost_rate_usd_cents`).
     * This is the number an R&D-credit or capitalization filing needs — the AI/LLM
     * `costUsd` above is compute spend, not what the people cost.
     */
    laborUsd: number;
    /** Of `hours`, those belonging to a member with a modelled rate — the hours
     *  `laborUsd` prices. `hours - ratedHours` is what a blended fallback covers. */
    ratedHours: number;
    /**
     * Of `hours`, how many came from RECORDED time (`time_entries`) rather than a
     * cycle-time estimate, and that share as a percentage.
     *
     * It is reported rather than assumed because the two are not interchangeable
     * evidence. A capitalization number that is 90% measured and one that is 0%
     * measured can print identically; only this says which you are holding.
     */
    loggedHours: number;
    measuredEffortPct: number;
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
 *
 * `loggedByTask` and `rateByMember` are what make the LABOUR half of this report
 * real rather than modelled (AIIMP-5). Both are optional and both default to
 * empty, so a caller that has neither gets exactly the previous behaviour — an
 * estimate, correctly labelled as one.
 */
export function summarizeAllocation(
  rows: AllocationTaskRow[],
  costByTask: Map<number, number>,
  windowDays: number,
  now: number,
  goals: AllocationGoalMap = new Map(),
  /** task id → lineage-resolved CAPEX/OPEX (closes SPINE-2; omit = category default). */
  lineage?: Map<number, 'capex' | 'opex'>,
  /** task id → REAL minutes recorded against it in the window (`time_entries`). */
  loggedByTask: Map<number, number> = new Map(),
  /** 'kind:ref' → the member's own $/hour (`member_profiles.cost_rate_usd_cents`). */
  rateByMember: Map<string, number> = new Map(),
): AllocationInsights {
  const cat = (c: AllocationCategory) => ({
    category: c, label: allocationCategoryLabel(c),
    hours: 0, pct: 0, taskCount: 0, costUsd: 0, capexUsd: 0, opexUsd: 0, laborUsd: 0, ratedHours: 0, loggedHours: 0,
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
      hours: 0, fteMonths: 0, costUsd: 0, laborUsd: 0, ratedHours: 0, loggedHours: 0, taskCount: 0,
      projectName: r.projectName ?? null,
    });
  }

  let totalHours = 0, totalCost = 0, capex = 0, opex = 0;

  let totalLaborUsd = 0, totalRatedHours = 0, totalLoggedHours = 0;

  for (const r of rows) {
    const c = effectiveCategory(r);
    const loggedMinutes = loggedByTask.get(r.taskId) ?? 0;
    const hrs = taskEffortHours(r, now, loggedMinutes);
    const costUsd = (costByTask.get(r.taskId) ?? 0) / MILLICENTS_PER_USD;
    const klass = effectiveCostClass(r, lineage);

    const id = identityOf(r);
    const memberKey = id ? `${id.kind}:${id.ref}` : null;
    // Priced at the OWNER's rate. A member with no modelled rate contributes 0
    // labour dollars while still contributing hours — the alternative, spreading a
    // workspace average over them, would invent salary data.
    const rate = memberKey ? rateByMember.get(memberKey) ?? null : null;
    const laborUsd = rate == null ? 0 : rate * hrs;
    const ratedHours = rate == null ? 0 : hrs;
    const loggedHours = loggedMinutes > 0 ? hrs : 0;

    const bucket = byCat.get(c)!;
    bucket.hours += hrs;
    bucket.taskCount += 1;
    bucket.costUsd += costUsd;
    bucket.laborUsd += laborUsd;
    bucket.ratedHours += ratedHours;
    bucket.loggedHours += loggedHours;
    if (klass === 'capex') bucket.capexUsd += costUsd; else bucket.opexUsd += costUsd;

    const sb = byStatus[capitalizationStatus(r, lineage)];
    sb.hours += hrs; sb.costUsd += costUsd; sb.taskCount += 1;
    sb.laborUsd += laborUsd; sb.ratedHours += ratedHours; sb.loggedHours += loggedHours;

    const epicId = r.taskType === 'epic' ? r.taskId
      : (r.parentTaskId != null && epicAgg.has(r.parentTaskId) ? r.parentTaskId : null);
    if (epicId != null) {
      const e = epicAgg.get(epicId)!;
      e.hours += hrs; e.costUsd += costUsd; e.taskCount += 1;
      e.laborUsd += laborUsd; e.ratedHours += ratedHours; e.loggedHours += loggedHours;
    }

    totalHours += hrs;
    totalCost += costUsd;
    totalLaborUsd += laborUsd;
    totalRatedHours += ratedHours;
    totalLoggedHours += loggedHours;
    if (klass === 'capex') capex += costUsd; else opex += costUsd;

    if (id && memberKey) {
      const m = memberAgg.get(memberKey) ?? { kind: id.kind, ref: id.ref, name: id.name, total: 0, cats: new Map() };
      m.total += hrs;
      m.cats.set(c, (m.cats.get(c) ?? 0) + hrs);
      memberAgg.set(memberKey, m);
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
      laborUsd: totalLaborUsd,
      ratedHours: totalRatedHours,
      loggedHours: totalLoggedHours,
      measuredEffortPct: totalHours > 0 ? (totalLoggedHours / totalHours) * 100 : 0,
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

  // REAL recorded time for the same window, and each member's own rate. Both are
  // already-collected data this report simply never asked for (AIIMP-5): a tenant
  // could fill in every timesheet and set every salary band, and the investment
  // mix, the capitalization FTE-months and the R&D credit base would still have
  // been derived from ticket open/close timestamps.
  const [loggedByTask, rateByMember, lineage] = await Promise.all([
    loggedMinutesByTask(db, tenantId, taskIds, { from: isoDay(since), to: isoDay(new Date(now)) }),
    loadMemberHourlyRates(db, tenantId),
    opts.lineage ? loadTaskCostClassMap(db, tenantId) : Promise.resolve(undefined),
  ]);

  return summarizeAllocation(scoped, costByTask, days, now, goals, lineage, loggedByTask, rateByMember);
}

/**
 * 'kind:ref' → the member's hourly rate in dollars, from the modelled cost rate.
 *
 * One query, no join: the map is applied in memory against rows already loaded.
 * Members with no rate are simply absent, which the caller reads as "no salary
 * data for this person" — deliberately NOT as zero and NOT as the workspace
 * average, either of which would be inventing compensation data.
 */
export async function loadMemberHourlyRates(db: Db, tenantId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ memberKind: memberProfiles.memberKind, memberRef: memberProfiles.memberRef, cents: memberProfiles.costRateUsdCents })
    .from(memberProfiles)
    .where(eq(memberProfiles.tenantId, tenantId));
  const out = new Map<string, number>();
  for (const r of rows) if (r.cents != null) out.set(`${r.memberKind}:${r.memberRef}`, r.cents / 100);
  return out;
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
  /**
   * Of the month's effort hours, how many came from RECORDED time
   * (`time_entries`) rather than a cycle-time estimate, and that share as a
   * percentage — the same disclosure `AllocationInsights.totals` carries.
   *
   * The monthly series used to omit it, so a row built entirely from timesheets
   * and a row built entirely from ticket open/close guesses printed identically.
   * A capitalization figure carried into an accounting system has to say which
   * one it is, and it has to say it PER MONTH: the month a team started logging
   * time is the month its numbers changed meaning, and a single workspace-level
   * percentage hides exactly that.
   */
  loggedHours: number;
  hours: number;
  measuredEffortPct: number;
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
 * Millicents of LLM spend keyed by `${taskId}:${'YYYY-MM'}` — the month the money
 * was ACTUALLY spent, not the month the ticket was last touched. See
 * {@link spendKey} and {@link summarizeAllocationHistory}.
 */
export type CostByTaskMonth = Map<string, number>;

/** The one key format for {@link CostByTaskMonth}, so the writer and the reader
 *  cannot disagree about it. */
export function spendKey(taskId: number, month: string): string {
  return `${taskId}:${month}`;
}

/**
 * Pure: bucket task effort into the month each task last moved (completedAt, else
 * updatedAt) and its LLM spend into the month that spend was actually incurred,
 * both split by {@link capitalizationStatus}.
 *
 * ── WHY THE TWO HALVES ARE BUCKETED DIFFERENTLY ─────────────────────────────
 * They answer different questions and only one of them has a real date.
 *
 * EFFORT has no per-day record to distribute — a task's hours are derived from
 * its lifecycle (or from time entries in aggregate), so the honest thing is to
 * attribute them to the month the task last moved. That is an "as-of" reading and
 * it is labelled as one.
 *
 * COST does have a real date: every `llm_usage_log` row is stamped at the moment
 * of the call. Attributing it to the task's as-of month was a genuine
 * misstatement rather than an approximation — a ticket opened in March, worked
 * through April and closed in June reported ALL of its March-to-June API spend as
 * June spend. A finance team reconciling this report against the vendor invoice
 * would find the totals agree for the year and disagree for every month in it,
 * which is exactly the failure that makes a report unusable for accrual.
 *
 * So cost is now keyed by (task, real spend month) and lands where it was spent,
 * while the task's capitalization STATUS still classifies it — a dollar spent in
 * March on work later classified as capitalized is capitalized March spend.
 * `taskCount` continues to count tasks in their as-of month; it is a count of
 * work, not of money.
 *
 * `loggedByTask` is the second correction: without it this function called
 * `taskEffortHours(r, now)` with no logged minutes, so the monthly FTE-months
 * were a pure cycle-time estimate even on a workspace that had logged every hour
 * — while the donut directly above the table used the real figure. Two numbers on
 * one screen, derived from the same tasks, disagreeing.
 */
export function summarizeAllocationHistory(
  rows: AllocationTaskRow[],
  costByTaskMonth: CostByTaskMonth,
  months: number,
  now: number,
  lineage?: Map<number, 'capex' | 'opex'>,
  /** task id → REAL minutes recorded against it in the window (`time_entries`). */
  loggedByTask: Map<number, number> = new Map(),
): AllocationHistory {
  const keys = recentMonthKeys(now, months);
  const allowed = new Set(keys);
  const current = monthKey(new Date(now));
  const blank = (): AllocationHistoryMonth => ({
    month: '', status: 'ready',
    capitalizedFteMonths: 0, totalFteMonths: 0,
    capitalizedUsd: 0, notCapitalizedUsd: 0, uncategorizedUsd: 0, totalUsd: 0, taskCount: 0,
    loggedHours: 0, hours: 0, measuredEffortPct: 0,
  });
  const byMonth = new Map<string, AllocationHistoryMonth>(keys.map((k) => [k, { ...blank(), month: k, status: k === current ? 'in_progress' : 'ready' }]));

  for (const r of rows) {
    const status = capitalizationStatus(r, lineage);

    // ── Effort → the task's as-of month ──
    const when = r.completedAt ?? r.updatedAt;
    const asOf = monthKey(new Date(when));
    if (allowed.has(asOf)) {
      const bucket = byMonth.get(asOf)!;
      const loggedMinutes = loggedByTask.get(r.taskId) ?? 0;
      const hrs = taskEffortHours(r, now, loggedMinutes);
      const fte = fteMonthsFromHours(hrs);
      bucket.totalFteMonths += fte;
      bucket.taskCount += 1;
      bucket.hours += hrs;
      if (loggedMinutes > 0) bucket.loggedHours += hrs;
      if (status === 'capitalized') bucket.capitalizedFteMonths += fte;
    }

    // ── Cost → the month each dollar was actually spent ──
    for (const month of keys) {
      const millicents = costByTaskMonth.get(spendKey(r.taskId, month));
      if (!millicents) continue;
      const bucket = byMonth.get(month)!;
      const costUsd = millicents / MILLICENTS_PER_USD;
      bucket.totalUsd += costUsd;
      if (status === 'capitalized') bucket.capitalizedUsd += costUsd;
      else if (status === 'not_capitalized') bucket.notCapitalizedUsd += costUsd;
      else bucket.uncategorizedUsd += costUsd;
    }
  }

  for (const m of byMonth.values()) {
    m.measuredEffortPct = m.hours > 0 ? (m.loggedHours / m.hours) * 100 : 0;
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
  const costByTaskMonth: CostByTaskMonth = new Map();
  if (taskIds.length) {
    // Aggregated in SQL by (task, spend month) rather than pulled row-by-row and
    // summed here. Two reasons, and both matter: the report needs the month
    // dimension it never had, and a busy workspace's raw `llm_usage_log` over
    // twelve months is tens of thousands of rows to ship into the isolate for a
    // sum Postgres will do in the index.
    //
    // `to_char(created_at, 'YYYY-MM')` reads the same month `monthKey()` does:
    // the column is `timestamp` WITHOUT time zone, which Drizzle parses by
    // appending `+0000`, so both sides are looking at UTC. Do not "fix" one of
    // them to local time on its own.
    const costRows = await db
      .select({
        taskId: llmUsageLog.taskId,
        month: sql<string>`to_char(${llmUsageLog.createdAt}, 'YYYY-MM')`,
        cost: sql<number>`sum(${llmUsageLog.costUsdMillicents})`,
      })
      .from(llmUsageLog)
      .where(and(
        eq(llmUsageLog.tenantId, tenantId),
        isNotNull(llmUsageLog.taskId),
        inArray(llmUsageLog.taskId, taskIds),
        gte(llmUsageLog.createdAt, since),
      ))
      .groupBy(llmUsageLog.taskId, sql`to_char(${llmUsageLog.createdAt}, 'YYYY-MM')`);
    for (const cr of costRows) {
      if (cr.taskId == null) continue;
      costByTaskMonth.set(spendKey(cr.taskId, cr.month), Number(cr.cost) || 0);
    }
  }

  // Real recorded time over the same window, so the monthly FTE-months use the
  // same effort rule as the donut above them (AIIMP-5) instead of falling back to
  // a cycle-time estimate the live view had already stopped using.
  const [loggedByTask, lineage] = await Promise.all([
    loggedMinutesByTask(db, tenantId, taskIds, { from: isoDay(since), to: isoDay(new Date(now)) }),
    opts.lineage ? loadTaskCostClassMap(db, tenantId) : Promise.resolve(undefined),
  ]);
  return summarizeAllocationHistory(scoped, costByTaskMonth, months, now, lineage, loggedByTask);
}

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
import {
  ALLOCATION_CATEGORIES,
  allocationCategoryLabel,
  defaultCostClassFor,
  deriveAllocationCategory,
  normalizeAllocationCategory,
  type AllocationCategory,
} from '../llm/allocationCategories';

const HOUR_MS = 3_600_000;
const MILLICENTS_PER_USD = 100_000;
/** Bound on tasks scanned per window (mirrors workforceMetrics.MAX_METRIC_ROWS). */
const MAX_METRIC_ROWS = 5_000;
/** Cap per-task effort hours so a single long-lived/stale task can't dominate the
 *  mix (30 days). Effort here is a signal-derived estimate, not a timesheet. */
const MAX_TASK_HOURS = 24 * 30;

export interface AllocationTaskRow extends MemberIdentityFields {
  taskId: number;
  title: string | null;
  description: string | null;
  source: string | null;
  actionType: string | null;
  allocationCategory: string | null;
  costClass: string | null;
  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
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
 *  category default (GAAP-conservative: only innovation capitalizes). */
export function effectiveCostClass(r: AllocationTaskRow): 'capex' | 'opex' {
  if (r.costClass === 'capex' || r.costClass === 'opex') return r.costClass;
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
  };
  byCategory: CategoryAllocation[];
  byMember: MemberAllocation[];
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

  let totalHours = 0, totalCost = 0, capex = 0, opex = 0;

  for (const r of rows) {
    const c = effectiveCategory(r);
    const hrs = taskEffortHours(r, now);
    const costUsd = (costByTask.get(r.taskId) ?? 0) / MILLICENTS_PER_USD;
    const klass = effectiveCostClass(r);

    const bucket = byCat.get(c)!;
    bucket.hours += hrs;
    bucket.taskCount += 1;
    bucket.costUsd += costUsd;
    if (klass === 'capex') bucket.capexUsd += costUsd; else bucket.opexUsd += costUsd;

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

  return {
    windowDays,
    totals: {
      hours: totalHours,
      taskCount: rows.length,
      costUsd: totalCost,
      capexUsd: capex,
      opexUsd: opex,
      capitalizablePct: capex + opex > 0 ? (capex / (capex + opex)) * 100 : 0,
    },
    byCategory,
    byMember,
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
): Promise<AllocationInsights> {
  const since = new Date(now - days * 24 * HOUR_MS);

  const where = [
    eq(projects.tenantId, tenantId),
    eq(tasks.archived, false),
    gte(tasks.updatedAt, since),
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

  return summarizeAllocation(scoped, costByTask, days, now, goals);
}

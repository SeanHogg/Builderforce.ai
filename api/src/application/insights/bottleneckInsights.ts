/**
 * BOTTLENECK ANALYSIS lens — /api/insights/bottlenecks
 *
 * The delivery lens answers "are we on track" (burnup / forecast / scope creep);
 * THIS lens answers the orthogonal question "WHICH stage is slow and WHY" — the
 * Jellyfish "pinpoint exactly where work stalls" gap. It derives, over a window:
 *
 *   - byStage:    avg + median time-in-status per stage (hours) and how many
 *                 tasks passed through it, ordered slowest first.
 *   - slowestStage: the single stage with the highest avg time-in-status (the
 *                 bottleneck), with its value.
 *   - rework:     reopen/redo loop signal (sum + rate) from the denormalized
 *                 tasks.redoCount / tasks.reopenCount counters.
 *   - agingWip:   currently-open tasks (status not done/cancelled) idle past a
 *                 threshold (since lastWorkedAt, else createdAt) — the "stuck
 *                 right now" actionable list.
 *
 * Time-in-status is derived from CONSECUTIVE transitions per task (sort a task's
 * transitions by occurredAt, diff each pair → the earlier row's toStatus held the
 * task for that interval). The final/current status of an open task has no closing
 * transition, so its dwell is counted from the last transition up to "now" (for
 * open tasks) — that is what surfaces aging WIP inside the stage rollup too.
 *
 * SIMPLIFICATION: if a task has NO transitions in the window (the log is sparse /
 * pre-dates the transition emitter, migration 0117), we fall back to a single
 * (completedAt − createdAt) interval bucketed under the task's FINAL status, so
 * historical tasks still contribute a coarse time-in-stage signal rather than
 * vanishing. This is documented on {@link buildStageDurations}.
 *
 * The pure math ({@link buildStageDurations}, {@link summarizeStages},
 * {@link summarizeRework}, {@link summarizeAgingWip}) is unit-tested without a DB;
 * {@link computeBottleneckInsights} is the thin DB shell (two bounded queries +
 * the cap pattern from workforceMetrics).
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projects, tasks, taskStatusTransitions } from '../../infrastructure/database/schema';

const HOUR_MS = 3_600_000;

/** Hard cap on rows scanned per window — mirrors workforceMetrics.MAX_METRIC_ROWS
 *  so the JS-side aggregation stays bounded on a very large tenant. */
const MAX_ROWS = 5_000;

/** Statuses that mean the task has left the board (excluded from aging WIP, and
 *  whose dwell is NOT extended to "now"). Mirrors reportRoutes.DONE_CLASS_STATUSES
 *  plus 'cancelled' (a task can be closed without being done). */
export const TERMINAL_STATUSES = new Set<string>(['done', 'cancelled']);

/** A task is "stuck" once it has sat untouched for this long (hours). 72h = 3
 *  working days; the threshold is a parameter so it is testable / tunable. */
export const DEFAULT_AGING_THRESHOLD_HOURS = 72;

/** Top-N oldest stuck tasks surfaced in the actionable list. */
export const AGING_TOP_N = 10;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ── inputs (DB-shaped but plain, so tests construct them directly) ─────────────

export interface TransitionRow {
  taskId: number;
  fromStatus: string | null;
  toStatus: string;
  occurredAt: Date;
}

export interface TaskRow {
  taskId: number;
  key: string;
  title: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  lastWorkedAt: Date | null;
  redoCount: number;
  reopenCount: number;
}

// ── stage durations (pure) ─────────────────────────────────────────────────────

/** One observed interval a task spent in one stage. */
export interface StageDuration { stage: string; hours: number; taskId: number }

/**
 * Turn the raw transition log + task lifecycle into per-stage dwell intervals.
 *
 * For each task: sort its transitions by occurredAt and diff consecutive rows —
 * the EARLIER row's `toStatus` is the stage the task occupied for that gap. The
 * final (current) status has no closing transition; for an OPEN task we extend it
 * to `now` (so a task stuck in review right now shows up as review dwell), and for
 * a terminal task we stop at its last transition.
 *
 * Tasks with NO transitions fall back to a single (completedAt − createdAt)
 * interval under the FINAL status (sparse-log simplification — see file header).
 */
export function buildStageDurations(
  transitions: TransitionRow[],
  taskRows: TaskRow[],
  now: number,
): StageDuration[] {
  const byTask = new Map<number, TransitionRow[]>();
  for (const tr of transitions) {
    const list = byTask.get(tr.taskId) ?? [];
    list.push(tr);
    byTask.set(tr.taskId, list);
  }

  const out: StageDuration[] = [];
  for (const task of taskRows) {
    const trs = (byTask.get(task.taskId) ?? []).slice().sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    if (trs.length === 0) {
      // Sparse-log fallback: one coarse interval under the final status.
      const end = task.completedAt?.getTime() ?? now;
      const hours = (end - task.createdAt.getTime()) / HOUR_MS;
      if (hours >= 0) out.push({ stage: task.status, hours, taskId: task.taskId });
      continue;
    }

    // Consecutive diffs: trs[i].toStatus held the task until trs[i+1].occurredAt.
    for (let i = 0; i < trs.length - 1; i++) {
      const hours = (trs[i + 1]!.occurredAt.getTime() - trs[i]!.occurredAt.getTime()) / HOUR_MS;
      if (hours >= 0) out.push({ stage: trs[i]!.toStatus, hours, taskId: task.taskId });
    }

    // The final transition's toStatus is the current stage. Extend an open task's
    // dwell to now; a terminal task's clock stopped at the last transition.
    const last = trs[trs.length - 1]!;
    if (!TERMINAL_STATUSES.has(last.toStatus)) {
      const hours = (now - last.occurredAt.getTime()) / HOUR_MS;
      if (hours >= 0) out.push({ stage: last.toStatus, hours, taskId: last.taskId });
    }
  }
  return out;
}

// ── stage rollup (pure) ────────────────────────────────────────────────────────

export interface StageStat {
  stage: string;
  avgHours: number;
  medianHours: number;
  /** Distinct tasks that passed through this stage in the window. */
  taskCount: number;
}

/** Group dwell intervals by stage → avg/median hours + distinct task count,
 *  ordered slowest (highest avg) first. Stable stage-name tiebreak. */
export function summarizeStages(durations: StageDuration[]): StageStat[] {
  const byStage = new Map<string, { hours: number[]; tasks: Set<number> }>();
  for (const d of durations) {
    const b = byStage.get(d.stage) ?? { hours: [], tasks: new Set<number>() };
    b.hours.push(d.hours);
    b.tasks.add(d.taskId);
    byStage.set(d.stage, b);
  }
  const out: StageStat[] = [];
  for (const [stage, b] of byStage) {
    out.push({
      stage,
      avgHours: avg(b.hours) ?? 0,
      medianHours: median(b.hours) ?? 0,
      taskCount: b.tasks.size,
    });
  }
  return out.sort((a, b) => b.avgHours - a.avgHours || a.stage.localeCompare(b.stage));
}

export interface SlowestStage { stage: string; avgHours: number }

/** The bottleneck = the slowest stage (summarizeStages is already sorted). */
export function pickSlowestStage(stages: StageStat[]): SlowestStage | null {
  const top = stages[0];
  return top ? { stage: top.stage, avgHours: top.avgHours } : null;
}

// ── rework (pure) ──────────────────────────────────────────────────────────────

export interface ReworkSummary {
  /** Tasks with at least one reopen OR redo (a rework loop occurred). */
  reworkedTasks: number;
  totalReopens: number;
  totalRedos: number;
  /** reworkedTasks / sampleSize, 0..1. */
  reworkRate: number;
}

/** Reopen/redo loop signal across the sampled tasks. */
export function summarizeRework(taskRows: TaskRow[]): ReworkSummary {
  let reworkedTasks = 0, totalReopens = 0, totalRedos = 0;
  for (const t of taskRows) {
    const reopens = t.reopenCount || 0;
    const redos = t.redoCount || 0;
    totalReopens += reopens;
    totalRedos += redos;
    if (reopens + redos > 0) reworkedTasks += 1;
  }
  return {
    reworkedTasks,
    totalReopens,
    totalRedos,
    reworkRate: taskRows.length ? reworkedTasks / taskRows.length : 0,
  };
}

// ── aging WIP (pure) ───────────────────────────────────────────────────────────

export interface AgingTask {
  taskId: number;
  key: string;
  title: string;
  status: string;
  ageHours: number;
}
export interface AgingWipSummary {
  thresholdHours: number;
  /** Count of open tasks idle past the threshold. */
  stuckCount: number;
  /** The top-N oldest stuck tasks, oldest first. */
  oldest: AgingTask[];
}

/**
 * Currently-open tasks (status not terminal) whose idle time — since lastWorkedAt
 * if present, else createdAt — exceeds the threshold. Returns the count plus the
 * top-N oldest as an actionable "unstick these now" list.
 */
export function summarizeAgingWip(
  taskRows: TaskRow[],
  now: number,
  thresholdHours = DEFAULT_AGING_THRESHOLD_HOURS,
  topN = AGING_TOP_N,
): AgingWipSummary {
  const aging: AgingTask[] = [];
  for (const t of taskRows) {
    if (TERMINAL_STATUSES.has(t.status)) continue;
    const since = (t.lastWorkedAt ?? t.createdAt).getTime();
    const ageHours = (now - since) / HOUR_MS;
    if (ageHours >= thresholdHours) {
      aging.push({ taskId: t.taskId, key: t.key, title: t.title, status: t.status, ageHours });
    }
  }
  aging.sort((a, b) => b.ageHours - a.ageHours);
  return { thresholdHours, stuckCount: aging.length, oldest: aging.slice(0, topN) };
}

// ── public shape ───────────────────────────────────────────────────────────────

export interface BottleneckInsights {
  windowDays: number;
  sampleSize: number;
  byStage: StageStat[];
  slowestStage: SlowestStage | null;
  rework: ReworkSummary;
  agingWip: AgingWipSummary;
}

/**
 * Tasks carry no tenant_id, so scope by joining projects — the same pattern as
 * computeMemberMetrics / computeDora. Two bounded queries (tasks in window, then
 * their transitions by id-set) avoid any N+1; all aggregation is pure JS.
 */
export async function computeBottleneckInsights(db: Db, tenantId: number, days: number): Promise<BottleneckInsights> {
  const now = Date.now();
  const since = new Date(now - days * 24 * HOUR_MS);

  const taskRows = (await db
    .select({
      taskId: tasks.id,
      key: tasks.key,
      title: tasks.title,
      status: tasks.status,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      lastWorkedAt: tasks.lastWorkedAt,
      redoCount: tasks.redoCount,
      reopenCount: tasks.reopenCount,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.archived, false),
      gte(tasks.updatedAt, since),
    ))
    .orderBy(desc(tasks.updatedAt))
    .limit(MAX_ROWS)) as TaskRow[];

  const taskIds = taskRows.map((r) => r.taskId);
  let transitions: TransitionRow[] = [];
  if (taskIds.length) {
    transitions = (await db
      .select({
        taskId: taskStatusTransitions.taskId,
        fromStatus: taskStatusTransitions.fromStatus,
        toStatus: taskStatusTransitions.toStatus,
        occurredAt: taskStatusTransitions.occurredAt,
      })
      .from(taskStatusTransitions)
      .where(inArray(taskStatusTransitions.taskId, taskIds))) as TransitionRow[];
  }

  const durations = buildStageDurations(transitions, taskRows, now);
  const byStage = summarizeStages(durations);

  return {
    windowDays: days,
    sampleSize: taskRows.length,
    byStage,
    slowestStage: pickSlowestStage(byStage),
    rework: summarizeRework(taskRows),
    agingWip: summarizeAgingWip(taskRows, now),
  };
}

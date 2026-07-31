/**
 * LIFE CYCLE EXPLORER lens — /api/insights/delivery/lifecycle
 *
 * The Jellyfish "Life Cycle Explorer": a full picture of how long each step of
 * the SDLC takes and how that is trending. Where the bottleneck lens ranks raw
 * board STATUSES by dwell, this rolls those statuses up into the four canonical
 * value-delivery PHASES — Refinement → Work → Review → Deploy — so a deliverable's
 * time is reported as the value chain a stakeholder recognises, plus the end-to-end
 * lifecycle trend (avg create→done time per month).
 *
 * It deliberately REUSES the bottleneck lens's stage-dwell derivation
 * ({@link buildStageDurations}) rather than re-deriving time-in-status — same raw
 * intervals, mapped to a phase and re-aggregated. The pure math
 * ({@link mapStatusToPhase}, {@link summarizePhases}, {@link summarizeLifecycleTrend})
 * is unit-tested without a DB; {@link computeLifecycleInsights} is the thin DB shell
 * (the same two bounded queries as the bottleneck lens).
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projects, tasks, taskStatusTransitions } from '../../infrastructure/database/schema';
import { notSystemTask } from '../task/taskScope';
import {
  avg, median, buildStageDurations,
  type StageDuration, type TransitionRow, type TaskRow,
} from './bottleneckInsights';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_ROWS = 5_000;

export type LifecyclePhase = 'refinement' | 'work' | 'review' | 'deploy';

/** Canonical phase order for display (the value chain left→right). */
export const LIFECYCLE_PHASES: LifecyclePhase[] = ['refinement', 'work', 'review', 'deploy'];

/**
 * Map a raw board status to a canonical SDLC phase, or null if it does not
 * represent active work time (terminal/cancelled). Matching is substring-based and
 * lower-cased so tenant-custom status names ("In Code Review", "QA Testing",
 * "Deploying to prod") still land in the right phase.
 */
export function mapStatusToPhase(status: string): LifecyclePhase | null {
  const s = status.toLowerCase();
  if (/(cancel|abandon|wont|won't|archive)/.test(s)) return null;
  if (/(deploy|releas|ship|staging|rollout|launch)/.test(s)) return 'deploy';
  if (/(review|qa|test|verif|approv|sign.?off)/.test(s)) return 'review';
  if (/(progress|doing|develop|build|implement|coding|wip|active)/.test(s)) return 'work';
  if (/(refine|backlog|todo|to.?do|triage|groom|plan|ready|spec|design|discov|new|open)/.test(s)) return 'refinement';
  if (s === 'done' || s === 'completed' || s === 'closed') return null; // terminal, no active dwell
  // Unknown status → treat as work (the default "in flight" bucket) so its time
  // is never silently dropped from the lifecycle total.
  return 'work';
}

export interface PhaseStat {
  phase: LifecyclePhase;
  avgHours: number;
  medianHours: number;
  /** Distinct tasks that passed through any status in this phase. */
  taskCount: number;
}

/** Roll stage-dwell intervals up into the four canonical phases (avg/median hours
 *  + distinct task count), always returned in canonical order — phases with no
 *  observed dwell appear with zeros so the chart shows the full chain. */
export function summarizePhases(durations: StageDuration[]): PhaseStat[] {
  const byPhase = new Map<LifecyclePhase, { hours: number[]; tasks: Set<number> }>();
  for (const d of durations) {
    const phase = mapStatusToPhase(d.stage);
    if (!phase) continue;
    const b = byPhase.get(phase) ?? { hours: [], tasks: new Set<number>() };
    b.hours.push(d.hours);
    b.tasks.add(d.taskId);
    byPhase.set(phase, b);
  }
  return LIFECYCLE_PHASES.map((phase) => {
    const b = byPhase.get(phase);
    return {
      phase,
      avgHours: b ? (avg(b.hours) ?? 0) : 0,
      medianHours: b ? (median(b.hours) ?? 0) : 0,
      taskCount: b ? b.tasks.size : 0,
    };
  });
}

export interface LifecycleTrendPoint {
  /** 'YYYY-MM' bucket of the completion month. */
  period: string;
  /** Mean end-to-end lifecycle (createdAt→completedAt) for tasks completed that
   *  month, in hours. */
  avgLifecycleHours: number;
  taskCount: number;
}

/** End-to-end lifecycle trend: bucket completed tasks by completion month and take
 *  the mean (completedAt − createdAt). Oldest month first, last `months` buckets. */
export function summarizeLifecycleTrend(taskRows: TaskRow[], now: number, months = 6): LifecycleTrendPoint[] {
  const horizon = now - months * 31 * DAY_MS;
  const byMonth = new Map<string, number[]>();
  for (const t of taskRows) {
    if (!t.completedAt) continue;
    const ms = t.completedAt.getTime();
    if (ms < horizon) continue;
    const d = new Date(ms);
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const hours = (ms - t.createdAt.getTime()) / HOUR_MS;
    if (hours < 0) continue;
    const list = byMonth.get(period) ?? [];
    list.push(hours);
    byMonth.set(period, list);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, hrs]) => ({ period, avgLifecycleHours: avg(hrs) ?? 0, taskCount: hrs.length }));
}

export interface LifecycleInsights {
  windowDays: number;
  sampleSize: number;
  /** Sum of phase averages = the average time a task spends moving through the chain. */
  totalAvgHours: number;
  byPhase: PhaseStat[];
  trend: LifecycleTrendPoint[];
}

/** Thin DB shell — mirrors computeBottleneckInsights (two bounded queries, cap
 *  pattern), then maps the same dwell intervals into phases + the lifecycle trend. */
export async function computeLifecycleInsights(db: Db, tenantId: number, days: number, projectId?: number): Promise<LifecycleInsights> {
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
      ...(projectId != null ? [eq(tasks.projectId, projectId)] : []),
      eq(tasks.archived, false),
      gte(tasks.updatedAt, since),
      notSystemTask,
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
  const byPhase = summarizePhases(durations);

  return {
    windowDays: days,
    sampleSize: taskRows.length,
    totalAvgHours: byPhase.reduce((a, p) => a + p.avgHours, 0),
    byPhase,
    trend: summarizeLifecycleTrend(taskRows, now),
  };
}

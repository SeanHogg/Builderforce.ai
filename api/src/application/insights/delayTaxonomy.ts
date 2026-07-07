/**
 * LENS — Delay root-cause taxonomy (EMP-9).
 *
 * task_status_transitions (0117) records WHEN work stalled (dwell per status); this
 * lens answers WHY. Two signals are blended:
 *   - MANUAL tags from delay_reasons (0315) — a PM's authoritative reason on a task.
 *   - AUTO-INFERRED reasons from the transition log — the status a task stalled
 *     longest in maps to a taxonomy reason (a blocked lane → blocked_dependency, a
 *     review/QA lane → awaiting_review, an active/queue lane → capacity).
 * A manual tag always wins over the inferred reason for the same task.
 *
 * Output: the distribution of delay reasons (task counts + manual/inferred split)
 * and the average worst-stall dwell per reason. {@link summarizeDelays} is pure.
 */

import { and, eq, gte, desc } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { delayReasons, taskStatusTransitions } from '../../infrastructure/database/schema';

const HOUR_MS = 3_600_000;
/** Only stalls longer than this are treated as an inferred delay. */
const MIN_STALL_HOURS = 24;
const MAX_TRANSITION_ROWS = 20_000;

/** Fixed reason taxonomy (mirrors the delay_reasons.reason_code CHECK-in-spirit). */
export const DELAY_REASONS = [
  'blocked_dependency', 'awaiting_review', 'scope_change',
  'unclear_requirements', 'external', 'capacity', 'other',
] as const;
export type DelayReasonCode = (typeof DELAY_REASONS)[number];

export function isDelayReason(x: unknown): x is DelayReasonCode {
  return typeof x === 'string' && (DELAY_REASONS as readonly string[]).includes(x);
}

const REASON_LABELS: Record<DelayReasonCode, string> = {
  blocked_dependency: 'Blocked by dependency',
  awaiting_review: 'Awaiting review',
  scope_change: 'Scope change',
  unclear_requirements: 'Unclear requirements',
  external: 'External blocker',
  capacity: 'Capacity / queue',
  other: 'Other',
};

/**
 * Pure: map the status a task stalled in to a taxonomy reason. Names are matched
 * loosely (boards vary). Returns 'other' for an unrecognised active lane. scope_change
 * and unclear_requirements are intent-level and can only be tagged manually.
 */
export function inferReasonFromStatus(status: string): DelayReasonCode {
  const s = status.toLowerCase();
  if (/(block|depend|wait)/.test(s)) return 'blocked_dependency';
  if (/(review|approv)/.test(s)) return 'awaiting_review';
  if (/(qa|test|verif)/.test(s)) return 'awaiting_review';
  if (/(progress|doing|wip|dev|backlog|todo|to[_-]?do|ready|queue)/.test(s)) return 'capacity';
  return 'other';
}

export interface TransitionRow { taskId: number; toStatus: string; occurredAt: Date; }

/** Per-task worst stall: the status it sat in longest + that dwell in hours. */
export interface TaskStall { taskId: number; status: string; dwellHours: number; }

/**
 * Pure: from a task's ordered transitions, find its single worst stall (the status
 * with the greatest consecutive dwell). Returns null when the task never crosses
 * the MIN_STALL_HOURS floor (it never meaningfully stalled in the window).
 */
export function worstStall(transitions: TransitionRow[]): TaskStall | null {
  if (transitions.length < 2) return null;
  const sorted = [...transitions].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let best: TaskStall | null = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]!, next = sorted[i + 1]!;
    const dwellHours = (next.occurredAt.getTime() - cur.occurredAt.getTime()) / HOUR_MS;
    if (dwellHours >= MIN_STALL_HOURS && (!best || dwellHours > best.dwellHours)) {
      best = { taskId: cur.taskId, status: cur.toStatus, dwellHours };
    }
  }
  return best;
}

export interface DelayReasonBucket {
  reasonCode: DelayReasonCode;
  label: string;
  taskCount: number;
  manualCount: number;
  inferredCount: number;
  avgDwellHours: number | null;
}

export interface DelayTaxonomyResult {
  windowDays: number;
  taggedTasks: number;     // tasks with a manual OR inferred reason
  manualTags: number;      // tasks with a manual reason
  inferredTasks: number;   // tasks with only an inferred reason
  reasons: DelayReasonBucket[];
}

/**
 * Pure: blend manual tags with inferred stalls into the reason distribution. Each
 * task contributes to exactly ONE reason — its manual tag when present, else its
 * inferred worst-stall reason. Dwell for a manual tag uses the task's worst stall
 * when available (so the magnitude is honest even for a hand-tagged reason).
 */
export function summarizeDelays(
  windowDays: number,
  manualByTask: Map<number, DelayReasonCode>,
  stallByTask: Map<number, TaskStall>,
): DelayTaxonomyResult {
  const buckets = new Map<DelayReasonCode, { tasks: number; manual: number; inferred: number; dwell: number[] }>();
  const ensure = (r: DelayReasonCode) => {
    const b = buckets.get(r) ?? { tasks: 0, manual: 0, inferred: 0, dwell: [] };
    buckets.set(r, b);
    return b;
  };

  const taskIds = new Set<number>([...manualByTask.keys(), ...stallByTask.keys()]);
  let manualTags = 0, inferredTasks = 0;
  for (const taskId of taskIds) {
    const manual = manualByTask.get(taskId);
    const stall = stallByTask.get(taskId);
    const reason = manual ?? (stall ? inferReasonFromStatus(stall.status) : null);
    if (!reason) continue;
    const b = ensure(reason);
    b.tasks += 1;
    if (manual) { b.manual += 1; manualTags += 1; } else { b.inferred += 1; inferredTasks += 1; }
    if (stall) b.dwell.push(stall.dwellHours);
  }

  const reasons: DelayReasonBucket[] = DELAY_REASONS.map((r) => {
    const b = buckets.get(r);
    return {
      reasonCode: r,
      label: REASON_LABELS[r],
      taskCount: b?.tasks ?? 0,
      manualCount: b?.manual ?? 0,
      inferredCount: b?.inferred ?? 0,
      avgDwellHours: b && b.dwell.length ? b.dwell.reduce((a, c) => a + c, 0) / b.dwell.length : null,
    };
  }).filter((r) => r.taskCount > 0).sort((a, b) => b.taskCount - a.taskCount);

  return {
    windowDays,
    taggedTasks: reasons.reduce((a, r) => a + r.taskCount, 0),
    manualTags,
    inferredTasks,
    reasons,
  };
}

/** I/O: fetch manual tags + windowed transitions, derive stalls, summarise. */
export async function computeDelayTaxonomy(db: Db, tenantId: number, days: number): Promise<DelayTaxonomyResult> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);

  const [manualRows, transitionRows] = await Promise.all([
    db.select({ taskId: delayReasons.taskId, reasonCode: delayReasons.reasonCode })
      .from(delayReasons)
      .where(eq(delayReasons.tenantId, tenantId)),
    db.select({ taskId: taskStatusTransitions.taskId, toStatus: taskStatusTransitions.toStatus, occurredAt: taskStatusTransitions.occurredAt })
      .from(taskStatusTransitions)
      .where(and(eq(taskStatusTransitions.tenantId, tenantId), gte(taskStatusTransitions.occurredAt, since)))
      .orderBy(desc(taskStatusTransitions.occurredAt))
      .limit(MAX_TRANSITION_ROWS) as Promise<TransitionRow[]>,
  ]);

  const manualByTask = new Map<number, DelayReasonCode>();
  for (const r of manualRows) if (isDelayReason(r.reasonCode)) manualByTask.set(r.taskId, r.reasonCode);

  const byTask = new Map<number, TransitionRow[]>();
  for (const t of transitionRows) {
    const list = byTask.get(t.taskId) ?? [];
    list.push(t);
    byTask.set(t.taskId, list);
  }
  const stallByTask = new Map<number, TaskStall>();
  for (const [taskId, list] of byTask) {
    const stall = worstStall(list);
    if (stall) stallByTask.set(taskId, stall);
  }

  return summarizeDelays(days, manualByTask, stallByTask);
}

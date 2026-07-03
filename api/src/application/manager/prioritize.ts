/**
 * prioritize — the AI Manager's PURE backlog-ranking core.
 *
 * "Items are not ordered in priority" is the reported problem: the mechanical
 * autonomous sweep dispatches oldest-updated-first, ignoring how important or how
 * urgent a ticket is. This module turns each ticket's priority, business value and
 * due date into ONE comparable score, then produces a stable 1..N rank the
 * priority-aware dispatcher and the board default-sort both consume — so the team
 * (human and agent) always works the highest-value, most-urgent work first.
 *
 * Pure + deterministic: `now` is injected (no `Date.now()`), so the ranking is
 * unit-testable and reproducible. No IO — the caller loads rows and persists the
 * resulting `manager_rank`.
 */

/** Priority tiers mirror the tasks.priority enum. */
export type TaskPriorityTier = 'low' | 'medium' | 'high' | 'urgent';

/** The minimal ticket shape the ranker needs — a projection of a `tasks` row. */
export interface RankableTask {
  taskId: number;
  priority: TaskPriorityTier;
  /** 0-100 business value; null when unscored (treated as the neutral midpoint). */
  businessValue: number | null;
  /** Due date (ISO string or Date); null when undated. */
  dueDate: string | Date | null;
  /** Current board status key — started work gets a small finish-it bonus. */
  status: string;
  /** Creation time (ISO string or Date) — the age tiebreaker + starvation guard. */
  createdAt: string | Date;
}

export interface RankedTask {
  taskId: number;
  /** 1-based rank; 1 = work this first. */
  rank: number;
  /** The composite score the rank derives from (higher = more important). */
  score: number;
  /** The component contributions, surfaced so the manager can EXPLAIN the order. */
  factors: {
    priority: number;
    value: number;
    urgency: number;
    progress: number;
    age: number;
  };
}

const PRIORITY_SCORE: Record<TaskPriorityTier, number> = {
  urgent: 100,
  high: 70,
  medium: 40,
  low: 15,
};

/** Unscored tickets rank as if mid-value so they neither float nor sink unfairly. */
export const NEUTRAL_BUSINESS_VALUE = 40;

/** In-progress work gets a finish-it nudge so ranking never thrashes a started ticket. */
const PROGRESS_BONUS: Record<string, number> = {
  in_progress: 18,
  in_review: 10,
  blocked: -12, // blocked work waits on something else — deprioritize, don't starve.
};

const DAY_MS = 86_400_000;

function toTime(v: string | Date | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Due-date urgency on a 0-100 scale. Overdue → 100 (and slightly more the longer
 * it's overdue, capped). Due within the horizon ramps up as the date nears; undated
 * or far-out → 0. Deliberately saturates so a wildly-overdue ticket can't dominate
 * the whole score.
 */
export function urgencyScore(dueDate: string | Date | null, now: number, horizonDays = 14): number {
  const due = toTime(dueDate);
  if (due == null) return 0;
  const daysUntil = (due - now) / DAY_MS;
  if (daysUntil <= 0) {
    // Overdue: full urgency + a small overdue creep, capped at 120 pre-clamp.
    return Math.min(120, 100 + Math.min(20, -daysUntil));
  }
  if (daysUntil >= horizonDays) return 0;
  // Linear ramp from 0 (at the horizon) to ~92 (due tomorrow).
  return Math.round((1 - daysUntil / horizonDays) * 92);
}

/**
 * Composite importance score for one ticket. Weighted blend of priority, business
 * value, due-date urgency, an in-progress finish-it bonus, and a gentle age term
 * that lifts long-waiting tickets so nothing starves forever.
 */
export function scoreTask(task: RankableTask, now: number): RankedTask['factors'] & { score: number } {
  const priority = PRIORITY_SCORE[task.priority] ?? PRIORITY_SCORE.medium;
  const value = task.businessValue ?? NEUTRAL_BUSINESS_VALUE;
  const urgency = urgencyScore(task.dueDate, now);
  const progress = PROGRESS_BONUS[task.status] ?? 0;

  const created = toTime(task.createdAt) ?? now;
  const ageDays = Math.max(0, (now - created) / DAY_MS);
  // Anti-starvation: +1 per waiting day, capped so age never overrides real priority.
  const age = Math.min(15, ageDays);

  const score =
    0.4 * priority +
    0.35 * value +
    0.2 * urgency +
    progress +
    age;

  return { priority, value, urgency, progress, age, score: Math.round(score * 100) / 100 };
}

/**
 * Rank a project's backlog. Returns every input task with a 1..N `manager_rank`,
 * highest score first. Ties break by earliest creation (older work goes first),
 * then by taskId for total determinism.
 */
export function rankBacklog(tasks: RankableTask[], now: number): RankedTask[] {
  const scored = tasks.map((t) => {
    const { score, ...factors } = scoreTask(t, now);
    return { taskId: t.taskId, score, factors, createdAt: toTime(t.createdAt) ?? now };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.taskId - b.taskId;
  });

  return scored.map((s, i) => ({
    taskId: s.taskId,
    rank: i + 1,
    score: s.score,
    factors: s.factors,
  }));
}

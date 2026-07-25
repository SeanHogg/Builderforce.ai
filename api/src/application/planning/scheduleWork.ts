/**
 * scheduleWork — THE one place that turns "what work" into "WHEN".
 *
 * The planning stack could describe work (decomposition) and order it by score
 * (the manager's rank), but nothing ever answered "when does this start, when is
 * it due, and what has to finish first" — so every dated surface (planning spine,
 * Gantt, calendar, urgency scoring) read from columns that were always null.
 *
 * This module is that missing step, and it is deliberately PURE (no DB, no clock
 * except the `anchor` its caller passes) so both writers can share it without
 * either owning the rules:
 *
 *   • {@link TaskService.decomposeEpic} — fan-out children of an Epic get windows
 *     rolled down from the Epic's own window plus their sibling precedence.
 *   • the AI Manager's SCHEDULE pass — unscheduled backlog tickets get windows in
 *     rank order, honouring the `task_dependencies` DAG.
 *
 * Semantics:
 *   - Days are WORKING days (Mon–Fri). A 2-day task starting Friday ends Monday.
 *   - A dependency edge is finish-to-start: a successor starts the next working
 *     day after its last predecessor ends.
 *   - Given a `deadline`, the schedule COMPRESSES to fit (estimates scale down,
 *     floor of one day each) rather than silently overrunning the parent window.
 *     If it still cannot fit at one day per item, it overruns and says so via
 *     {@link ScheduleResult.overruns} — a plan that cannot fit is information, not
 *     something to hide.
 *   - Cycles cannot deadlock it: any item left unresolved by the topological walk
 *     is scheduled from the anchor and reported in {@link ScheduleResult.cyclic}.
 */

const DAY_MS = 86_400_000;

/** Estimate used when nobody (LLM, human, story points) expressed one. */
export const DEFAULT_ESTIMATE_DAYS = 2;
/** Upper bound on a single item's estimate — beyond this it is an Epic, not a task. */
export const MAX_ESTIMATE_DAYS = 60;

/** Clamp an arbitrary estimate to a sane whole number of working days. */
export function normalizeEstimateDays(value: unknown, fallback = DEFAULT_ESTIMATE_DAYS): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_ESTIMATE_DAYS, Math.max(1, Math.round(n)));
}

/**
 * Story points → working-day estimate. Fibonacci points are a relative size, so the
 * mapping is deliberately shallow (1pt ≈ half a day, capped): the point is to stop
 * every ticket sharing one flat default, not to pretend points are hours.
 */
export function estimateDaysFromStoryPoints(points: number | null | undefined): number | null {
  if (points == null || !Number.isFinite(points) || points <= 0) return null;
  return normalizeEstimateDays(Math.ceil(points / 2));
}

/** Midnight UTC of the given instant — schedules are whole days, never clock times. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** The same day if it is a weekday, else the following Monday. */
export function nextWorkingDay(date: Date): Date {
  let d = startOfUtcDay(date);
  while (isWeekend(d)) d = new Date(d.getTime() + DAY_MS);
  return d;
}

/**
 * Advance `days` WORKING days from `from`. `days = 0` returns `from` normalized to a
 * working day, so an N-day item spans `start … addWorkingDays(start, N - 1)`.
 */
export function addWorkingDays(from: Date, days: number): Date {
  let d = nextWorkingDay(from);
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    d = nextWorkingDay(new Date(d.getTime() + DAY_MS));
    remaining -= 1;
  }
  return d;
}

/** Inclusive count of working days between two dates (>= 1). */
export function workingDaysBetween(from: Date, to: Date): number {
  const start = nextWorkingDay(from);
  const end = startOfUtcDay(to);
  if (end <= start) return 1;
  let count = 1;
  let cursor = start;
  while (cursor < end) {
    cursor = nextWorkingDay(new Date(cursor.getTime() + DAY_MS));
    if (cursor <= end) count += 1;
  }
  return count;
}

/** One unit of work to place on the timeline. */
export interface SchedulableItem {
  /** Stable identity — a task id, or a fan-out index before ids exist. */
  key: string;
  /** Working-day estimate. Missing/invalid falls back to {@link DEFAULT_ESTIMATE_DAYS}. */
  estimateDays?: number | null;
  /** Keys that must FINISH before this item starts. Unknown keys are ignored. */
  afterKeys?: string[] | null;
}

export interface ScheduledWindow {
  startDate: Date;
  endDate: Date;
  /** Working days actually allocated (after any compression to fit a deadline). */
  days: number;
}

export interface ScheduleResult {
  windows: Map<string, ScheduledWindow>;
  /** Earliest start / latest end across every scheduled item (null when no items). */
  span: { startDate: Date; endDate: Date } | null;
  /** True when estimates were scaled down to fit the caller's deadline. */
  compressed: boolean;
  /** Keys whose window ends after the caller's deadline (only when a deadline was given). */
  overruns: string[];
  /** Keys involved in a precedence cycle — scheduled from the anchor rather than dropped. */
  cyclic: string[];
}

export interface ScheduleOptions {
  /** No item starts before this day (typically the parent's start, or today). */
  anchor: Date;
  /** Optional target the whole set should fit inside (the parent's due date). */
  deadline?: Date | null;
}

/**
 * Place every item on the timeline: topological order by precedence, forward pass
 * from the anchor, compressed once if a deadline demands it.
 */
export function scheduleItems(items: readonly SchedulableItem[], opts: ScheduleOptions): ScheduleResult {
  const anchor = nextWorkingDay(opts.anchor);
  const deadline = opts.deadline ? startOfUtcDay(opts.deadline) : null;

  const empty: ScheduleResult = {
    windows: new Map(), span: null, compressed: false, overruns: [], cyclic: [],
  };
  if (items.length === 0) return empty;

  const known = new Set(items.map((i) => i.key));
  const preds = new Map<string, string[]>();
  for (const item of items) {
    preds.set(item.key, (item.afterKeys ?? []).filter((k) => k !== item.key && known.has(k)));
  }

  // Kahn's algorithm — anything left over sits in a cycle and is reported, not dropped.
  const indegree = new Map<string, number>(items.map((i) => [i.key, preds.get(i.key)!.length]));
  const successors = new Map<string, string[]>();
  for (const [key, list] of preds) {
    for (const p of list) successors.set(p, [...(successors.get(p) ?? []), key]);
  }
  const order: string[] = [];
  const queue = items.filter((i) => indegree.get(i.key) === 0).map((i) => i.key);
  while (queue.length) {
    const key = queue.shift() as string;
    order.push(key);
    for (const s of successors.get(key) ?? []) {
      const next = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, next);
      if (next === 0) queue.push(s);
    }
  }
  const cyclic = items.map((i) => i.key).filter((k) => !order.includes(k));
  const walkOrder = [...order, ...cyclic];

  const byKey = new Map(items.map((i) => [i.key, i]));
  const estimateOf = (key: string, scale: number): number =>
    Math.max(1, Math.round(normalizeEstimateDays(byKey.get(key)?.estimateDays) * scale));

  const pass = (scale: number): Map<string, ScheduledWindow> => {
    const windows = new Map<string, ScheduledWindow>();
    for (const key of walkOrder) {
      let start = anchor;
      // A cyclic item has no trustworthy precedence, so it starts at the anchor.
      if (!cyclic.includes(key)) {
        for (const p of preds.get(key) ?? []) {
          const pw = windows.get(p);
          if (pw) {
            const after = nextWorkingDay(new Date(pw.endDate.getTime() + DAY_MS));
            if (after > start) start = after;
          }
        }
      }
      const days = estimateOf(key, scale);
      windows.set(key, { startDate: start, endDate: addWorkingDays(start, days - 1), days });
    }
    return windows;
  };

  let windows = pass(1);
  let compressed = false;

  if (deadline) {
    const latest = [...windows.values()].reduce<Date | null>(
      (max, w) => (max == null || w.endDate > max ? w.endDate : max), null,
    );
    if (latest && latest > deadline) {
      const available = workingDaysBetween(anchor, deadline);
      const needed = workingDaysBetween(anchor, latest);
      if (needed > 0 && available < needed) {
        windows = pass(Math.max(0.1, available / needed));
        compressed = true;
      }
    }
  }

  const starts = [...windows.values()].map((w) => w.startDate.getTime());
  const ends = [...windows.values()].map((w) => w.endDate.getTime());
  const span = starts.length
    ? { startDate: new Date(Math.min(...starts)), endDate: new Date(Math.max(...ends)) }
    : null;

  return {
    windows,
    span,
    compressed,
    overruns: deadline ? [...windows].filter(([, w]) => w.endDate > deadline).map(([k]) => k) : [],
    cyclic,
  };
}

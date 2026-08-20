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
 * Purity is a CONTRACT, not an accident: capacity, the working calendar and the
 * sprint cadence are all passed IN. A scheduler that reached for the database
 * could not be exercised over a holiday or an overloaded assignee without one, and
 * "the plan was wrong across the shutdown week" is not something to discover in
 * production.
 *
 * Semantics:
 *   - Days are WORKING days, decided by the caller's {@link WorkingCalendar}
 *     (default Mon-Fri, no holidays — the behaviour that used to be hardcoded).
 *     A 2-day task starting Friday ends Monday.
 *   - A dependency edge is finish-to-start: a successor starts the next working
 *     day after its last predecessor ends.
 *   - An item with an `assigneeKey` consumes that person's CAPACITY. One person
 *     runs one ticket at a time by default, so two tickets on one assignee
 *     SERIALISE instead of overlapping — the failure that made "who is doing what
 *     this week" impossible to trust off the plan.
 *   - Given `sprints`, an item that would straddle a sprint boundary is pushed to
 *     start at the next sprint instead, so a ticket lands inside one cadence.
 *   - Given a `deadline`, the schedule COMPRESSES to fit (estimates scale down,
 *     floor of one day each) rather than silently overrunning the parent window.
 *     If it still cannot fit at one day per item, it overruns and says so via
 *     {@link ScheduleResult.overruns} — a plan that cannot fit is information, not
 *     something to hide.
 *   - Cycles cannot deadlock it: any item left unresolved by the topological walk
 *     is scheduled from the anchor and reported in {@link ScheduleResult.cyclic}.
 */

import {
  DEFAULT_WORKING_CALENDAR,
  isWorkingDay,
  type WorkingCalendar,
} from './workingCalendarModel';

export {
  DEFAULT_WORKING_CALENDAR,
  isWorkingDay,
  normalizeWorkingCalendar,
  utcDayKey,
} from './workingCalendarModel';
export type { WorkingCalendar } from './workingCalendarModel';

const DAY_MS = 86_400_000;

/**
 * Hard stop on any forward day-walk. A calendar with one working weekday and a year
 * of holidays would otherwise spin forever looking for the next open day; past this
 * many consecutive closed days we accept the day we are on rather than hanging a
 * request. Two years is far past any real shutdown.
 */
const MAX_CLOSED_DAY_SCAN = 730;

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

/** The same day if the calendar works it, else the next day that it does. */
export function nextWorkingDay(date: Date, calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR): Date {
  let d = startOfUtcDay(date);
  for (let i = 0; i < MAX_CLOSED_DAY_SCAN && !isWorkingDay(d, calendar); i += 1) {
    d = new Date(d.getTime() + DAY_MS);
  }
  return d;
}

/**
 * Advance `days` WORKING days from `from`. `days = 0` returns `from` normalized to a
 * working day, so an N-day item spans `start … addWorkingDays(start, N - 1)`.
 */
export function addWorkingDays(
  from: Date,
  days: number,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): Date {
  let d = nextWorkingDay(from, calendar);
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    d = nextWorkingDay(new Date(d.getTime() + DAY_MS), calendar);
    remaining -= 1;
  }
  return d;
}

/** Inclusive count of working days between two dates (>= 1). */
export function workingDaysBetween(
  from: Date,
  to: Date,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): number {
  const start = nextWorkingDay(from, calendar);
  const end = startOfUtcDay(to);
  if (end <= start) return 1;
  let count = 1;
  let cursor = start;
  while (cursor < end) {
    cursor = nextWorkingDay(new Date(cursor.getTime() + DAY_MS), calendar);
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
  /**
   * WHO does it — any stable per-owner key (`user:<id>`, `agent:<ref>`, …). Items
   * sharing a key contend for that owner's capacity; null/absent means the item
   * consumes nobody's time and may run alongside anything.
   */
  assigneeKey?: string | null;
}

/**
 * How much of one owner's time is really available.
 *
 * The two dimensions are not the same thing and both are needed: `concurrency` is
 * how many items a person can HOLD at once (one, normally), while `availability` is
 * how much of each of those days they actually get — the member-metrics load
 * signal. A half-available person doing one ticket at a time takes twice as long
 * per ticket AND still cannot take a second one.
 */
export interface AssigneeCapacity {
  /** Items this owner can hold AT ONCE. Default 1 — one person, one ticket. */
  concurrency?: number;
  /** Share of each working day genuinely free, 0 < f <= 1. Default 1 (fully free). */
  availability?: number;
}

/** A cadence boundary work should sit inside — a `sprints` row, start/end inclusive. */
export interface SprintWindow {
  startDate: Date;
  endDate: Date;
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
  /**
   * Keys whose start was pushed out because their OWNER was already busy — the
   * evidence behind "why does this not start until the 20th?". Distinct from an
   * overrun: the plan still fits, one person is simply the constraint.
   */
  capacityDeferred: string[];
}

export interface ScheduleOptions {
  /** No item starts before this day (typically the parent's start, or today). */
  anchor: Date;
  /** Optional target the whole set should fit inside (the parent's due date). */
  deadline?: Date | null;
  /**
   * The tenant's working week + holidays. Passed IN so this stays pure; absent =
   * {@link DEFAULT_WORKING_CALENDAR} (Mon-Fri), i.e. the pre-calendar behaviour.
   */
  calendar?: WorkingCalendar;
  /**
   * Per-owner capacity, keyed by {@link SchedulableItem.assigneeKey}. An owner with
   * no entry is treated as one-at-a-time and fully available — the conservative
   * reading, because a plan must never assume MORE parallelism than it can evidence.
   */
  capacity?: ReadonlyMap<string, AssigneeCapacity> | Readonly<Record<string, AssigneeCapacity>>;
  /**
   * The sprint cadence to align to. Given these, an item that would straddle a
   * boundary starts at the next sprint instead; an item longer than a whole sprint
   * is left to span, because refusing to place it is not a plan.
   */
  sprints?: readonly SprintWindow[];
}

function capacityOf(source: ScheduleOptions['capacity'], key: string): Required<AssigneeCapacity> {
  const raw = source instanceof Map
    ? source.get(key)
    : (source as Record<string, AssigneeCapacity> | undefined)?.[key];
  const concurrency = raw?.concurrency;
  const availability = raw?.availability;
  return {
    concurrency: typeof concurrency === 'number' && Number.isFinite(concurrency) && concurrency >= 1
      ? Math.floor(concurrency)
      : 1,
    // A zero or negative "availability" would mean an infinite estimate; clamp to a
    // tenth of a day so a fully-loaded person stretches rather than divides by zero.
    availability: typeof availability === 'number' && Number.isFinite(availability) && availability > 0
      ? Math.min(1, Math.max(0.1, availability))
      : 1,
  };
}

/** Normalised, start-ordered sprint windows — invalid/reversed rows are dropped. */
function normalizeSprints(sprints: readonly SprintWindow[] | undefined): SprintWindow[] {
  return [...(sprints ?? [])]
    .filter((s) => s?.startDate instanceof Date && s?.endDate instanceof Date
      && !Number.isNaN(s.startDate.getTime()) && !Number.isNaN(s.endDate.getTime())
      && s.endDate >= s.startDate)
    .map((s) => ({ startDate: startOfUtcDay(s.startDate), endDate: startOfUtcDay(s.endDate) }))
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

/**
 * Place every item on the timeline: topological order by precedence, forward pass
 * from the anchor, each owner's capacity respected, aligned to the sprint cadence,
 * compressed once if a deadline demands it.
 */
export function scheduleItems(items: readonly SchedulableItem[], opts: ScheduleOptions): ScheduleResult {
  const calendar = opts.calendar ?? DEFAULT_WORKING_CALENDAR;
  const anchor = nextWorkingDay(opts.anchor, calendar);
  const deadline = opts.deadline ? startOfUtcDay(opts.deadline) : null;
  const sprints = normalizeSprints(opts.sprints);

  const empty: ScheduleResult = {
    windows: new Map(), span: null, compressed: false, overruns: [], cyclic: [], capacityDeferred: [],
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

  /**
   * The sprint containing `day`, or null when the cadence does not cover it (before
   * the first sprint, in a gap between two, or after the last). Uncovered days are
   * left alone rather than snapped — a cadence that has not been planned that far
   * out must not silently push every unplanned ticket into the last known sprint.
   */
  const sprintContaining = (day: Date): SprintWindow | null =>
    sprints.find((s) => day >= s.startDate && day <= s.endDate) ?? null;

  /** The first sprint that starts strictly after `day`, or null past the cadence. */
  const sprintAfter = (day: Date): SprintWindow | null =>
    sprints.find((s) => s.startDate > day) ?? null;

  const pass = (scale: number): { windows: Map<string, ScheduledWindow>; deferred: string[] } => {
    const windows = new Map<string, ScheduledWindow>();
    /** Placed windows per owner, so the next item on that owner sees the contention. */
    const busy = new Map<string, ScheduledWindow[]>();
    const deferred: string[] = [];

    for (const key of walkOrder) {
      const item = byKey.get(key);
      const assignee = item?.assigneeKey ?? null;
      const cap = assignee ? capacityOf(opts.capacity, assignee) : null;

      // Size: the estimate, scaled for a deadline, then stretched by how much of the
      // owner's day is really free. A half-available person takes twice as long.
      const base = Math.max(1, Math.round(normalizeEstimateDays(item?.estimateDays) * scale));
      const days = cap ? Math.max(1, Math.ceil(base / cap.availability)) : base;

      let start = anchor;
      // A cyclic item has no trustworthy precedence, so it starts at the anchor.
      if (!cyclic.includes(key)) {
        for (const p of preds.get(key) ?? []) {
          const pw = windows.get(p);
          if (pw) {
            const after = nextWorkingDay(new Date(pw.endDate.getTime() + DAY_MS), calendar);
            if (after > start) start = after;
          }
        }
      }

      const readyAt = start;
      let end = addWorkingDays(start, days - 1, calendar);

      // Alternate between the two placement constraints until both hold. Each turn
      // only ever moves `start` FORWARD, so this converges; the bound is a backstop
      // against a pathological cadence, not the expected exit.
      for (let attempt = 0; attempt < 16; attempt += 1) {
        // ── sprint alignment ────────────────────────────────────────────────
        // Work that straddles a boundary belongs to neither sprint and lands in both
        // burndowns; push it into the next one. An item longer than a whole sprint
        // cannot fit inside one, so it is left to span.
        const sprint = sprints.length ? sprintContaining(start) : null;
        if (sprint && end > sprint.endDate) {
          const sprintDays = workingDaysBetween(sprint.startDate, sprint.endDate, calendar);
          const next = sprintAfter(start);
          if (days <= sprintDays && next) {
            const moved = nextWorkingDay(next.startDate, calendar);
            if (moved > start) {
              start = moved;
              end = addWorkingDays(start, days - 1, calendar);
              continue;
            }
          }
        }

        // ── owner capacity ──────────────────────────────────────────────────
        // Two tickets on one person do not happen at the same time. Wait for the
        // owner's earliest slot rather than drawing an overlap nobody can honour.
        if (cap && assignee) {
          const held = busy.get(assignee) ?? [];
          const overlapping = held.filter((w) => w.startDate <= end && w.endDate >= start);
          if (overlapping.length >= cap.concurrency) {
            // Free at the point where enough of the blocking windows have ended.
            const endings = overlapping.map((w) => w.endDate.getTime()).sort((a, b) => a - b);
            // `overlapping` is non-empty here (its length met the concurrency cap), so
            // the index is in range; the fallback keeps that obvious to the reader.
            const firstFree = endings[Math.max(0, endings.length - cap.concurrency)] ?? endings[0] ?? start.getTime();
            const moved = nextWorkingDay(new Date(firstFree + DAY_MS), calendar);
            if (moved > start) {
              start = moved;
              end = addWorkingDays(start, days - 1, calendar);
              continue;
            }
          }
        }
        break;
      }

      if (start > readyAt) deferred.push(key);
      const window: ScheduledWindow = { startDate: start, endDate: end, days };
      windows.set(key, window);
      if (assignee) busy.set(assignee, [...(busy.get(assignee) ?? []), window]);
    }
    return { windows, deferred };
  };

  let placed = pass(1);
  let compressed = false;

  if (deadline) {
    const latest = [...placed.windows.values()].reduce<Date | null>(
      (max, w) => (max == null || w.endDate > max ? w.endDate : max), null,
    );
    if (latest && latest > deadline) {
      const available = workingDaysBetween(anchor, deadline, calendar);
      const needed = workingDaysBetween(anchor, latest, calendar);
      if (needed > 0 && available < needed) {
        placed = pass(Math.max(0.1, available / needed));
        compressed = true;
      }
    }
  }

  const { windows, deferred } = placed;
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
    capacityDeferred: deferred,
  };
}

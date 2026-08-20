/**
 * Shared timeline helpers for the Calendar and Gantt views.
 *
 * Generic over any {@link Schedulable} — anything with `startDate`/`dueDate` ISO
 * string fields (or null). Both `Project` (dates derived server-side from its
 * tasks) and `Task` (its own dates) satisfy this shape, so the Calendar/Gantt
 * components and these helpers are reused unchanged across both pages.
 */

/** Anything that can be placed on a timeline: a start and a deadline (either may be absent). */
export interface Schedulable {
  /** Earliest start, ISO string or null/absent. */
  startDate?: string | null;
  /** Deadline, ISO string or null/absent. */
  dueDate?: string | null;
}

export type DeadlineStatus = 'overdue' | 'soon' | 'upcoming' | 'none';

export interface ItemSchedule {
  start: Date | null;
  end: Date | null;
  status: DeadlineStatus;
}

/** Color tokens per deadline status, reused by both views for a single legend. */
export const DEADLINE_COLORS: Record<DeadlineStatus, string> = {
  overdue: 'var(--coral-bright)',
  soon: 'var(--warning)',
  upcoming: 'var(--coral-bright)',
  none: 'var(--text-muted)',
};

/** "Due soon" window, in days, ahead of today. */
const SOON_WINDOW_DAYS = 7;

export function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Midnight of the given date (local), so day comparisons ignore the clock time. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function deadlineStatus(end: Date | null, now: Date = new Date()): DeadlineStatus {
  if (!end) return 'none';
  const today = startOfDay(now);
  const due = startOfDay(end);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= SOON_WINDOW_DAYS) return 'soon';
  return 'upcoming';
}

/** Derive an item's timeline range + deadline status from its ISO date fields. */
export function getSchedule(item: Schedulable, now: Date = new Date()): ItemSchedule {
  const end = parseDate(item.dueDate);
  // If only a start exists, treat it as a single-day marker so it still renders.
  const start = parseDate(item.startDate) ?? end;
  return { start, end: end ?? start, status: deadlineStatus(end, now) };
}

/** Items that have at least one usable date, in deadline order (soonest first). */
export function scheduledItems<T extends Schedulable>(
  items: T[],
  now: Date = new Date(),
): Array<{ item: T; schedule: ItemSchedule }> {
  return items
    .map((item) => ({ item, schedule: getSchedule(item, now) }))
    .filter((s) => s.schedule.start && s.schedule.end)
    .sort((a, b) => a.schedule.end!.getTime() - b.schedule.end!.getTime());
}

const DAY_MS = 86_400_000;

/** Whole calendar days from `a` to `b` (negative when `b` is earlier). Both ends
 *  are normalised to local midnight first, so a DST transition inside the range
 *  cannot turn a 3-day gap into 2.96 and round to 2. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

/** `d` moved by `n` whole calendar days, preserving the clock time. Built from
 *  the date parts rather than `+ n * DAY_MS` so a shift across a DST boundary
 *  lands on the same wall-clock hour instead of drifting by one. */
export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// ── Rescheduling ─────────────────────────────────────────────────────────────

/**
 * Which end of the bar a drag is moving.
 *
 * `move` slides the whole window; `start` and `end` resize one edge. The three
 * are one vocabulary shared by the Gantt (bar body vs. its two grips) and the
 * Calendar (a span dropped on a new day is always a `move`), so a reschedule
 * means the same thing whichever view produced it.
 */
export type RescheduleMode = 'move' | 'start' | 'end';

/** The dates a reschedule wants written. Fields the item never had stay null. */
export interface ReschedulePatch {
  startDate: string | null;
  dueDate: string | null;
}

/**
 * The ONE rule for what dragging a scheduled item by `deltaDays` means.
 *
 * Pure, so both views compute the same patch and it is unit-testable without a
 * DOM. It exists as a function rather than inline arithmetic in each component
 * because the interesting cases are all edge cases and they must agree:
 *
 *   - An item with only a due date (a roadmap item, an undated-start task) keeps
 *     its start null. Materialising a start out of a drag would silently invent a
 *     schedule the user never entered.
 *   - Resizing past the other edge COLLAPSES to a single day rather than
 *     inverting the window — an end before its start is not a shorter task, it is
 *     a corrupt row, and Gantt bars render it as a negative width.
 *   - A no-op drag returns null so the caller issues no write at all. Round-trips
 *     that change nothing still bust caches and re-render boards.
 *
 * ISO strings are returned (not Dates) because that is what every write path on
 * the other side takes — the task PATCH, the project PATCH, the tracker PATCH.
 */
export function shiftSchedule(
  item: Schedulable,
  mode: RescheduleMode,
  deltaDays: number,
): ReschedulePatch | null {
  if (!Number.isFinite(deltaDays) || deltaDays === 0) return null;

  const start = parseDate(item.startDate);
  const end = parseDate(item.dueDate);
  if (!start && !end) return null;

  let nextStart = start;
  let nextEnd = end;

  if (mode === 'move') {
    if (start) nextStart = addDays(start, deltaDays);
    if (end) nextEnd = addDays(end, deltaDays);
  } else if (mode === 'start') {
    if (!start) return null;
    nextStart = addDays(start, deltaDays);
    // Collapse rather than invert: a dragged start may meet the deadline, never pass it.
    if (nextEnd && nextStart > nextEnd) nextStart = nextEnd;
  } else {
    if (!end) return null;
    nextEnd = addDays(end, deltaDays);
    if (nextStart && nextEnd < nextStart) nextEnd = nextStart;
  }

  const startIso = nextStart ? nextStart.toISOString() : null;
  const dueIso = nextEnd ? nextEnd.toISOString() : null;
  const unchanged =
    startIso === (start ? start.toISOString() : null) &&
    dueIso === (end ? end.toISOString() : null);
  return unchanged ? null : { startDate: startIso, dueDate: dueIso };
}

const FMT_SHORT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const FMT_LONG = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function formatShort(d: Date): string {
  return FMT_SHORT.format(d);
}

export function formatLong(d: Date): string {
  return FMT_LONG.format(d);
}

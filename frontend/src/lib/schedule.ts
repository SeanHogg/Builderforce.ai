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
  soon: '#e0a93f',
  upcoming: '#3f8fe0',
  none: 'var(--text-muted)',
};

export const DEADLINE_LABELS: Record<DeadlineStatus, string> = {
  overdue: 'Overdue',
  soon: 'Due soon',
  upcoming: 'Upcoming',
  none: 'No deadline',
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

const FMT_SHORT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const FMT_LONG = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function formatShort(d: Date): string {
  return FMT_SHORT.format(d);
}

export function formatLong(d: Date): string {
  return FMT_LONG.format(d);
}

import type { Project } from './types';

/**
 * Shared timeline helpers for the project Calendar and Gantt views.
 *
 * A project has no date column of its own — its schedule is derived server-side
 * from its tasks (see GET /api/projects): `startDate` is the earliest task start
 * (falling back to the earliest due date) and `dueDate` is the latest task due
 * date, i.e. the project deadline. Both arrive as ISO strings or null.
 */

export type DeadlineStatus = 'overdue' | 'soon' | 'upcoming' | 'none';

export interface ProjectSchedule {
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

/** Derive a project's timeline range + deadline status from its ISO date fields. */
export function getProjectSchedule(project: Project, now: Date = new Date()): ProjectSchedule {
  const end = parseDate(project.dueDate);
  // If only a start exists, treat it as a single-day marker so it still renders.
  const start = parseDate(project.startDate) ?? end;
  return { start, end: end ?? start, status: deadlineStatus(end, now) };
}

/** Projects that have at least one usable date, in deadline order (soonest first). */
export function scheduledProjects(
  projects: Project[],
  now: Date = new Date(),
): Array<{ project: Project; schedule: ProjectSchedule }> {
  return projects
    .map((project) => ({ project, schedule: getProjectSchedule(project, now) }))
    .filter((p) => p.schedule.start && p.schedule.end)
    .sort((a, b) => (a.schedule.end!.getTime() - b.schedule.end!.getTime()));
}

const FMT_SHORT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const FMT_LONG = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function formatShort(d: Date): string {
  return FMT_SHORT.format(d);
}

export function formatLong(d: Date): string {
  return FMT_LONG.format(d);
}

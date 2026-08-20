/**
 * The WORKING CALENDAR — which days a tenant's people actually work.
 *
 * The scheduler used to answer "is this a working day?" with a hardcoded Mon–Fri
 * test. That is wrong for every tenant that does not run a Western working week,
 * and it is wrong for EVERY tenant across a public holiday: a plan drawn over a
 * shutdown week reads as committed capacity that nobody will supply, and the
 * first person to notice is whoever misses the date.
 *
 * This module is the pure MODEL only (no DB, no env) so the scheduler can stay a
 * pure function and still be calendar-aware — {@link loadWorkingCalendar} in
 * `workingCalendar.ts` is the one place that reads a tenant's stored answer.
 */

/** Sunday…Saturday, matching `Date.getUTCDay()`. */
export const SUNDAY = 0;
export const SATURDAY = 6;

/** A tenant's working week plus the days nobody works. */
export interface WorkingCalendar {
  /**
   * Weekday numbers (0 = Sunday … 6 = Saturday) that count as working days.
   * Empty is not a calendar — it would make every date non-working and hang any
   * forward walk — so {@link normalizeWorkingCalendar} rejects it back to the default.
   */
  workingWeekdays: readonly number[];
  /** `YYYY-MM-DD` days nobody works: public holidays, company shutdown, … */
  holidays: readonly string[];
}

/**
 * Mon–Fri, no holidays — EXACTLY the behaviour that was hardcoded before this
 * existed. It is the default on purpose: a tenant that has configured nothing must
 * schedule identically to how it scheduled yesterday.
 */
export const DEFAULT_WORKING_CALENDAR: WorkingCalendar = Object.freeze({
  workingWeekdays: Object.freeze([1, 2, 3, 4, 5]) as readonly number[],
  holidays: Object.freeze([]) as readonly string[],
});

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce arbitrary stored/JSON input into a calendar the scheduler can safely walk.
 *
 * Deliberately total: bad data degrades to the default rather than throwing, because
 * a malformed settings row must never be able to stop the planner from producing a
 * plan — an un-dated board is a worse failure than an un-customised calendar.
 */
export function normalizeWorkingCalendar(input: unknown): WorkingCalendar {
  const raw = (input ?? {}) as { workingWeekdays?: unknown; holidays?: unknown };
  const days = Array.isArray(raw.workingWeekdays)
    ? [...new Set(raw.workingWeekdays
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= SUNDAY && d <= SATURDAY))].sort((a, b) => a - b)
    : [];
  const holidays = Array.isArray(raw.holidays)
    ? [...new Set(raw.holidays
      .map((h) => (typeof h === 'string' ? h.trim().slice(0, 10) : ''))
      .filter((h) => ISO_DAY_RE.test(h)))].sort()
    : [];
  return {
    workingWeekdays: days.length > 0 ? days : DEFAULT_WORKING_CALENDAR.workingWeekdays,
    holidays,
  };
}

/** `YYYY-MM-DD` in UTC — the key holidays are stored and compared under. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** True when work happens on this day for this calendar. */
export function isWorkingDay(date: Date, calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR): boolean {
  if (!calendar.workingWeekdays.includes(date.getUTCDay())) return false;
  return !calendar.holidays.includes(utcDayKey(date));
}

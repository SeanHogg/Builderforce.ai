/**
 * Reading and writing a tenant's WORKING CALENDAR (migration 1074).
 *
 * This is the DB half of `workingCalendarModel.ts`. The split is the whole point:
 * `scheduleItems` must stay a pure function, so it takes a {@link WorkingCalendar}
 * as a PARAMETER and this module is the only thing that knows a table exists. A
 * scheduler that reached for the database could not be exercised across a holiday
 * without one, and "the plan was wrong across the shutdown week" is not a thing to
 * discover in production.
 *
 * Read-through cached: every planning pass, every Epic fan-out and every manager
 * sweep needs the calendar, and it changes a handful of times a year. Writes
 * invalidate the key so a newly-declared holiday takes effect on the next plan
 * rather than after a TTL.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenantWorkingCalendars } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import {
  DEFAULT_WORKING_CALENDAR,
  normalizeWorkingCalendar,
  type WorkingCalendar,
} from './workingCalendarModel';

/** One named non-working day, as the settings UI edits it. */
export interface Holiday {
  /** `YYYY-MM-DD`. */
  date: string;
  /** What it is — shown so a gap in the Gantt reads as "Christmas Day", not as a bug. */
  name: string;
}

/** The stored, human-editable form. {@link WorkingCalendar} is what the planner sees. */
export interface WorkingCalendarSettings {
  /** Weekday numbers (0 = Sunday … 6 = Saturday) that count as working days. */
  workingWeekdays: number[];
  holidays: Holiday[];
  /** IANA zone the calendar was authored in; advisory (schedules are whole UTC days). */
  timezone: string | null;
  /** False when nothing has been configured and the built-in Mon-Fri default applies. */
  configured: boolean;
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A settings list a person maintains by hand. Past this it is a data feed, not settings. */
const MAX_HOLIDAYS = 400;

export function workingCalendarCacheKey(tenantId: number): string {
  return `planning:working-calendar:t:${tenantId}`;
}

/** The default a tenant that has configured nothing gets: Mon-Fri, no holidays. */
export function defaultWorkingCalendarSettings(): WorkingCalendarSettings {
  return {
    workingWeekdays: [...DEFAULT_WORKING_CALENDAR.workingWeekdays],
    holidays: [],
    timezone: null,
    configured: false,
  };
}

/**
 * Coerce arbitrary request/stored JSON into settings we will store.
 *
 * Total by design (it never throws): a malformed holiday entry is dropped rather
 * than rejecting the whole save, because losing one typo'd row is a far smaller
 * failure than a settings page that cannot be saved at all.
 */
export function normalizeWorkingCalendarSettings(input: unknown): WorkingCalendarSettings {
  const raw = (input ?? {}) as { workingWeekdays?: unknown; holidays?: unknown; timezone?: unknown };
  const weekdays = normalizeWorkingCalendar({ workingWeekdays: raw.workingWeekdays }).workingWeekdays;
  const seen = new Set<string>();
  const holidays: Holiday[] = [];
  for (const h of Array.isArray(raw.holidays) ? raw.holidays : []) {
    const entry = h as { date?: unknown; name?: unknown };
    const date = typeof entry?.date === 'string' ? entry.date.trim().slice(0, 10) : '';
    if (!ISO_DAY_RE.test(date) || seen.has(date)) continue;
    seen.add(date);
    holidays.push({
      date,
      name: (typeof entry?.name === 'string' ? entry.name.trim() : '').slice(0, 120),
    });
    if (holidays.length >= MAX_HOLIDAYS) break;
  }
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  const timezone = typeof raw.timezone === 'string' && raw.timezone.trim()
    ? raw.timezone.trim().slice(0, 64)
    : null;
  return { workingWeekdays: [...weekdays], holidays, timezone, configured: true };
}

/** Settings → the flat shape the pure scheduler consumes. */
export function toWorkingCalendar(settings: WorkingCalendarSettings): WorkingCalendar {
  return normalizeWorkingCalendar({
    workingWeekdays: settings.workingWeekdays,
    holidays: settings.holidays.map((h) => h.date),
  });
}

/** The tenant's stored settings, or the built-in default when none exist. */
export async function loadWorkingCalendarSettings(
  env: Env | undefined,
  db: Db,
  tenantId: number,
): Promise<WorkingCalendarSettings> {
  const load = async (): Promise<WorkingCalendarSettings> => {
    const [row] = await db.select({
      workingWeekdays: tenantWorkingCalendars.workingWeekdays,
      holidays: tenantWorkingCalendars.holidays,
      timezone: tenantWorkingCalendars.timezone,
    })
      .from(tenantWorkingCalendars)
      .where(eq(tenantWorkingCalendars.tenantId, tenantId))
      .limit(1);
    if (!row) return defaultWorkingCalendarSettings();
    return normalizeWorkingCalendarSettings(row);
  };
  if (!env) return load();
  return getOrSetCached(env, workingCalendarCacheKey(tenantId), load, {
    kvTtlSeconds: 3_600,
    l1TtlMs: 60_000,
  });
}

/**
 * The calendar the PLANNER needs. Separate entry point from the settings read so
 * every scheduling caller asks for exactly the shape it consumes and nothing has
 * to remember to convert.
 */
export async function loadWorkingCalendar(
  env: Env | undefined,
  db: Db,
  tenantId: number,
): Promise<WorkingCalendar> {
  return toWorkingCalendar(await loadWorkingCalendarSettings(env, db, tenantId));
}

/** Upsert the tenant's calendar and drop the cached copy so the next plan sees it. */
export async function saveWorkingCalendarSettings(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  input: unknown,
): Promise<WorkingCalendarSettings> {
  const settings = normalizeWorkingCalendarSettings(input);
  await db.insert(tenantWorkingCalendars)
    .values({
      tenantId,
      workingWeekdays: settings.workingWeekdays,
      holidays: settings.holidays,
      timezone: settings.timezone,
    })
    .onConflictDoUpdate({
      target: tenantWorkingCalendars.tenantId,
      set: {
        workingWeekdays: settings.workingWeekdays,
        holidays: settings.holidays,
        timezone: settings.timezone,
        updatedAt: new Date(),
      },
    });
  if (env) await invalidateCached(env, workingCalendarCacheKey(tenantId));
  return settings;
}

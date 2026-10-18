import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { liveExecution } from '../rehearsal/executionMode';

/**
 * Runs started per day over a trailing window — the workforce sparkline.
 *
 * The dashboard used to fetch the tenant's 200 newest FULL execution rows (payload
 * and result text included) only to bucket their `createdAt` by day in the browser,
 * which also undercounted any busy fortnight. This is the same series as a single
 * `GROUP BY` over the window: at most `days` rows leave Neon.
 *
 * Days are the CALLER's local calendar days: `tzOffsetMinutes` (minutes added to UTC,
 * i.e. `-Date#getTimezoneOffset()`) shifts both the clock and every timestamp
 * before they are truncated to a date, so "today" means the viewer's today.
 * `created_at` is a UTC `timestamp` (no zone), hence `now() at time zone 'utc'`.
 */
export const MAX_ACTIVITY_DAYS = 30;

export interface DayCount { daysAgo: number; count: number }

/** Place `daysAgo` counts into an oldest-first series of `days` points. Pure. */
export function fillDailySeries(rows: readonly DayCount[], days: number): number[] {
  const series = new Array<number>(days).fill(0);
  for (const row of rows) {
    const daysAgo = Number(row.daysAgo);
    const index = days - 1 - daysAgo;
    if (Number.isInteger(index) && index >= 0 && index < days) series[index] += Number(row.count) || 0;
  }
  return series;
}

export async function loadRunActivity(db: Db, tenantId: number, days: number, tzOffsetMinutes: number): Promise<number[]> {
  const shift = sql`make_interval(mins => ${tzOffsetMinutes}::int)`;
  const daysAgo = sql<number>`(((now() at time zone 'utc') + ${shift})::date - (${executions.createdAt} + ${shift})::date)`;
  const rows = await db
    .select({ daysAgo: sql<number>`${daysAgo}::int`, count: sql<number>`count(*)::int` })
    .from(executions)
    .where(and(
      eq(executions.tenantId, tenantId),
      gte(executions.createdAt, sql`(now() at time zone 'utc') - make_interval(days => ${days + 1}::int)`),
      liveExecution(),
    ))
    // By position: the day expression carries bound parameters, and Postgres does not
    // treat `$1`-in-SELECT and `$3`-in-GROUP-BY as the same expression.
    .groupBy(sql`1`);
  return fillDailySeries(rows, days);
}

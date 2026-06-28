/**
 * Date-windowed daily aggregation — the reusable primitive behind every
 * trend/sparkline widget. Buckets rows of an EXISTING table into one point per
 * day over the trailing `days` window (UTC calendar days, zero-filled), so any
 * count/sum metric in the dashboard registry can expose a series without each
 * surface hand-rolling its own `GROUP BY date_trunc` + gap-fill.
 *
 * One round-trip per metric, grouped in Postgres (no per-day query, no N+1); the
 * dashboards route caches the result through the canonical read-through cache.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';

export interface MetricPoint {
  /** UTC calendar day, 'YYYY-MM-DD'. */
  day: string;
  value: number;
}

const DAY_MS = 86_400_000;

/** UTC 'YYYY-MM-DD' for a Date or epoch-ms. */
export function dayKeyUTC(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** UTC midnight (epoch-ms) of the day `now` falls in. */
function utcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Expand a sparse `day → value` map into one dense point per day for the trailing
 * `days` window (oldest → newest), filling absent days with 0. Keeps every series
 * the same length as its window so sparklines/trends never imply data where there
 * is none.
 */
export function densifyDaily(byDay: Map<string, number>, days: number, now: number): MetricPoint[] {
  const todayUTC = utcMidnight(now);
  const out: MetricPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKeyUTC(todayUTC - i * DAY_MS);
    out.push({ day: key, value: byDay.get(key) ?? 0 });
  }
  return out;
}

/** First UTC-midnight Date at/after the start of the trailing `days` window. */
function windowStart(days: number, now: number): Date {
  return new Date(utcMidnight(now) - (days - 1) * DAY_MS);
}

/**
 * Daily ROW COUNT for a tenant-scoped table over the trailing window. e.g. error
 * events per day, agent runs per day. Returns a dense, zero-filled series.
 */
export async function dailyCountSeries(
  db: Db,
  table: PgTable,
  tenantCol: AnyPgColumn,
  tsCol: AnyPgColumn,
  tenantId: number,
  days: number,
  now: number = Date.now(),
): Promise<MetricPoint[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${tsCol}), 'YYYY-MM-DD')`,
      n: sql<number>`count(*)::int`,
    })
    .from(table)
    .where(and(eq(tenantCol, tenantId), gte(tsCol, windowStart(days, now))))
    .groupBy(sql`1`);

  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, Number(r.n));
  return densifyDaily(byDay, days, now);
}

/**
 * Daily SUM of a numeric column for a tenant-scoped table over the trailing
 * window. e.g. tokens per day. Returns a dense, zero-filled series.
 */
export async function dailySumSeries(
  db: Db,
  table: PgTable,
  tenantCol: AnyPgColumn,
  tsCol: AnyPgColumn,
  valueCol: AnyPgColumn,
  tenantId: number,
  days: number,
  now: number = Date.now(),
): Promise<MetricPoint[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${tsCol}), 'YYYY-MM-DD')`,
      total: sql<number>`coalesce(sum(${valueCol}), 0)::float8`,
    })
    .from(table)
    .where(and(eq(tenantCol, tenantId), gte(tsCol, windowStart(days, now))))
    .groupBy(sql`1`);

  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, Number(r.total));
  return densifyDaily(byDay, days, now);
}

/** Sum a series to its scalar total — the window total that pairs with the trend. */
export function seriesTotal(points: MetricPoint[]): number {
  return points.reduce((a, p) => a + p.value, 0);
}

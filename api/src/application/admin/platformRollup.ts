/**
 * Platform-wide historical rollup for the superadmin Health/Usage view.
 *
 * Unlike the tenant lenses (always tenant-scoped), this aggregates across the
 * WHOLE platform for the operator: user + workspace growth, LLM token/spend
 * volume, and error-event volume — each as a zero-filled daily series plus a
 * window total. Superadmin-only (the route sits behind superAdminMiddleware).
 *
 * One grouped round-trip per metric (no N+1); the route caches on a short TTL.
 */

import { and, gte, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { users, tenants, errorEvents } from '../../infrastructure/database/schema';
import { densifyDaily, type MetricPoint } from '../dashboards/dailySeries';
import type { Db } from '../../infrastructure/database/connection';
import { DAY_MS } from '../../domain/shared/time';
import { readUsageBreakdown } from '../llm/usageQuery';
import { millicentsToUsd } from '../../domain/shared/money';

function windowStart(days: number, now: number): Date {
  const mid = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return new Date(mid - (days - 1) * DAY_MS);
}

/** Platform-wide daily row COUNT (no tenant filter) over the trailing window. */
async function platformCount(db: Db, table: PgTable, tsCol: AnyPgColumn, days: number, now: number): Promise<MetricPoint[]> {
  const rows = await db
    .select({ day: sql<string>`to_char(date_trunc('day', ${tsCol}), 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
    .from(table)
    .where(gte(tsCol, windowStart(days, now)))
    .groupBy(sql`1`);
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, Number(r.n));
  return densifyDaily(byDay, days, now);
}

/**
 * Platform-wide daily tokens + spend from THE usage query use case — the platform
 * scope of the same day breakdown `/api/admin/llm-usage` charts, in ONE grouped scan
 * (this used to be two full scans of the ledger, one per column).
 */
async function platformUsageSeries(db: Db, days: number, now: number): Promise<{ tokens: MetricPoint[]; spendMc: MetricPoint[] }> {
  const rows = await readUsageBreakdown(db, { scope: { kind: 'platform' }, since: windowStart(days, now) }, 'day', { orderBy: 'key' });
  const tokens = new Map<string, number>();
  const spend = new Map<string, number>();
  for (const r of rows) {
    tokens.set(r.day, r.totalTokens);
    spend.set(r.day, r.costMc);
  }
  return { tokens: densifyDaily(tokens, days, now), spendMc: densifyDaily(spend, days, now) };
}

const total = (pts: MetricPoint[]) => pts.reduce((a, p) => a + p.value, 0);

export interface PlatformRollup {
  windowDays: number;
  totals: { newUsers: number; newTenants: number; tokens: number; spendUsd: number; errorEvents: number };
  series: {
    newUsers: MetricPoint[];
    newTenants: MetricPoint[];
    tokens: MetricPoint[];
    spendUsd: MetricPoint[];
    errorEvents: MetricPoint[];
  };
}

export async function computePlatformRollup(db: Db, days: number): Promise<PlatformRollup> {
  const now = Date.now();
  const [newUsers, newTenants, usage, errs] = await Promise.all([
    platformCount(db, users, users.createdAt, days, now),
    platformCount(db, tenants, tenants.createdAt, days, now),
    platformUsageSeries(db, days, now),
    platformCount(db, errorEvents, errorEvents.ts, days, now),
  ]);
  const { tokens } = usage;
  const spendUsd = usage.spendMc.map((p) => ({ day: p.day, value: millicentsToUsd(p.value) }));

  return {
    windowDays: days,
    totals: {
      newUsers: total(newUsers),
      newTenants: total(newTenants),
      tokens: total(tokens),
      spendUsd: total(spendUsd),
      errorEvents: total(errs),
    },
    series: { newUsers, newTenants, tokens, spendUsd, errorEvents: errs },
  };
}

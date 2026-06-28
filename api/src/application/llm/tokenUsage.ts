/**
 * Tenant token-usage accounting — THE single source of truth for "how many
 * text tokens has this tenant used in a window".
 *
 * Both the request-path gate (llmRoutes' daily + monthly caps) AND the read-only
 * consumption meter (consumptionRoutes / sidebar UsageMeter) sum the SAME
 * cache-discounted weight here, so the number a user SEES on the meter is exactly
 * the number that gets ENFORCED. No second, divergent definition of "usage".
 *
 * Cache weighting mirrors the cost tiers: cache_read counts at ~0.1x and
 * cache_creation at ~1.25x, so a tenant with a large cached prefix gets the
 * discount in their budget — not just in the logs.
 */

import { and, eq, gte, notInArray, sql, type SQL } from 'drizzle-orm';
import { llmUsageLog } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { CACHE_READ_MULTIPLIER, CACHE_CREATION_MULTIPLIER } from './usageLedger';
import { IMAGE_PRODUCT_NAMES } from './ImageProxyService';

/**
 * Per-row cache-discounted effective text-token weight. Defined ONCE; every
 * window sum reuses this fragment. The `::float8` casts stop Postgres inferring
 * the fractional multipliers as integer (which rejects "0.9"); the caller
 * re-integers the SUM.
 */
const rowWeight: SQL = sql`(
  ${llmUsageLog.totalTokens}
  - (${llmUsageLog.cacheReadTokens} * ${1 - CACHE_READ_MULTIPLIER}::float8)
  + (${llmUsageLog.cacheCreationTokens} * ${CACHE_CREATION_MULTIPLIER - 1}::float8)
)`;

/** Image generation meters against its OWN credit budget (migration 0131) — its
 *  rows never consume the text-token cap (and vice-versa). */
const notImageRow = notInArray(llmUsageLog.llmProduct, [...IMAGE_PRODUCT_NAMES]);

const toInt = (v: unknown): number => Math.max(0, Math.floor(Number(v ?? 0)));

/** Start of the current UTC day — the daily-cap reset boundary. */
export function utcDayStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Start of the current UTC calendar month — the monthly-allowance window start. */
export function utcMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Start of the next UTC calendar month — when the monthly meter resets to 0. */
export function utcNextMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Seconds until the monthly allowance resets (for Retry-After on a monthly cap). */
export function secondsUntilNextUtcMonth(now: Date = new Date()): number {
  return Math.max(1, Math.ceil((utcNextMonthStart(now).getTime() - now.getTime()) / 1000));
}

/**
 * Cache-discounted text-token usage for a tenant since `since` (a single window).
 * Used by the consumption meter.
 */
export async function sumTenantTextTokens(db: Db, tenantId: number, since: Date): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`COALESCE(SUM(${rowWeight}), 0)` })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, since), notImageRow));
  return toInt(row?.used);
}

/**
 * Per-day cache-discounted text-token usage since `since` (UTC day buckets,
 * sparse — only days with usage). Drives the consumption-meter sparkline; the
 * day totals sum to the SAME window total as {@link sumTenantTextTokens} (same
 * {@link rowWeight}, same image-exclusion), so meter + sparkline never disagree.
 * One grouped scan — it can stand in for the single-total query, not add to it.
 */
export async function dailyTenantTextTokens(
  db: Db,
  tenantId: number,
  since: Date,
): Promise<Array<{ day: string; tokens: number }>> {
  const dayExpr = sql<string>`to_char(${llmUsageLog.createdAt}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: dayExpr, used: sql<number>`COALESCE(SUM(${rowWeight}), 0)` })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, since), notImageRow))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
  return rows.map((r) => ({ day: r.day, tokens: toInt(r.used) }));
}

/**
 * Day + month usage in ONE table scan — the request-path gate needs both and a
 * single scan beats two round-trips. Month is the outer window; the day total is
 * a FILTER over the same rows, reusing the same {@link rowWeight} expression.
 */
export async function sumTenantTextTokensDayAndMonth(
  db: Db,
  tenantId: number,
  dayStart: Date,
  monthStart: Date,
): Promise<{ day: number; month: number }> {
  const [row] = await db
    .select({
      month: sql<number>`COALESCE(SUM(${rowWeight}), 0)`,
      day: sql<number>`COALESCE(SUM(${rowWeight}) FILTER (WHERE ${llmUsageLog.createdAt} >= ${dayStart}), 0)`,
    })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, monthStart), notImageRow));
  return { day: toInt(row?.day), month: toInt(row?.month) };
}

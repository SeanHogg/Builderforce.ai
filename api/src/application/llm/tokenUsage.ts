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

import { and, eq, gte, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { CACHE_READ_MULTIPLIER, CACHE_CREATION_MULTIPLIER, clampTokenCount, resolveUsageDatabase, usageDatabaseOf } from './usageLedger';
import { MEDIA_PRODUCT_NAMES } from './mediaProducts';

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

/** Image and video generation each meter against their OWN credit budget
 *  (migration 0131; video seconds) — their rows never consume the text-token cap
 *  (and vice-versa). See `mediaProducts.ts`. */
const notMediaRow = notInArray(llmUsageLog.llmProduct, [...MEDIA_PRODUCT_NAMES]);

/**
 * BYO exemption: a row served by the tenant's OWN provider credential (`byo`)
 * AND produced on the user's own machine (on-prem host or VSIX) is FREE — the
 * tenant paid their own provider — so it NEVER consumes the plan token allowance
 * (migration 0284). A BYO row on the `cloud` (or `web`/`sdk`) surface still
 * counts, so free tenants are charged for cloud-agent usage. Defined ONCE so the
 * request-path cap gate, the availability gate, AND the consumption meter apply
 * the exact same rule — "shown == enforced" holds for BYO too.
 */
const notFreeByoRow: SQL = sql`NOT (${llmUsageLog.byo} AND ${llmUsageLog.surface} IN ('on_prem', 'vsix'))`;

/** The single billable-row predicate every usage window reuses: exclude media
 *  rows (own budgets) AND own-machine BYO rows (free). One definition so no window
 *  can drift from the enforced total. */
const billableRow: SQL = and(notMediaRow, notFreeByoRow)!;

// Coerce a SQL SUM result (number, or a numeric string from pg/drizzle, or null
// from an empty window) to a non-negative integer via the SAME clamp the billing
// ledger uses ({@link clampTokenCount}) — one definition of "token count floor" so
// the meter and the ledger can't drift. `Number(v ?? 0)` handles the string/null
// coercion clampTokenCount's numeric signature doesn't.
const toInt = (v: unknown): number => clampTokenCount(Number(v ?? 0));

/** The "~4 chars per token" heuristic — defined ONCE in `@builderforce/workload` and
 *  shared with the router, the editor and the on-prem context guards. */
export { estimateTokensFromChars, estimateTokensFromText } from '@builderforce/workload';

/** Start of the current UTC day — the daily-cap reset boundary. */
export function utcDayStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Seconds remaining until the next UTC midnight — when every daily cap resets.
 *  Surfaced on cap-exhausted 429s as both `Retry-After` and `retryAfter`. */
export function secondsUntilNextUtcMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
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
  const [row] = await usageDatabaseOf(db)
    .select({ used: sql<number>`COALESCE(SUM(${rowWeight}), 0)` })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, since), billableRow));
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
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = sql<string>`to_char(${llmUsageLog.createdAt}, 'YYYY-MM-DD')`;
  const rows = await usageDatabaseOf(db)
    .select({ day: dayExpr, used: sql<number>`COALESCE(SUM(${rowWeight}), 0)` })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, since), billableRow))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
  return rows.map((r) => ({ day: r.day, value: toInt(r.used) }));
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
  /**
   * Exclusive upper bound. Omitted = "up to now", which is what every live gate
   * wants. The AI-credit reconcile sweep settles a month that has ALREADY ENDED
   * and so must bound the window on both sides — and it asks THIS function rather
   * than writing its own sum, because `billableRow` and `rowWeight` are the rule
   * for what counts as a spent token and a second copy of that rule is how the
   * number a sweep settles stops matching the number the gate enforced.
   */
  monthEnd?: Date,
): Promise<{ day: number; month: number }> {
  const [row] = await usageDatabaseOf(db)
    .select({
      month: sql<number>`COALESCE(SUM(${rowWeight}), 0)`,
      day: sql<number>`COALESCE(SUM(${rowWeight}) FILTER (WHERE ${llmUsageLog.createdAt} >= ${dayStart}), 0)`,
    })
    .from(llmUsageLog)
    .where(and(
      eq(llmUsageLog.tenantId, tenantId),
      gte(llmUsageLog.createdAt, monthStart),
      ...(monthEnd ? [lt(llmUsageLog.createdAt, monthEnd)] : []),
      billableRow,
    ));
  return { day: toInt(row?.day), month: toInt(row?.month) };
}

// ── Per-request cap totals (cached) ─────────────────────────────────────────────────
//
// The gateway gates every request on FOUR usage figures — today's and this month's
// text tokens, today's paid-overflow spend and today's premium spend — which used to be
// three-plus separate uncached SUMs over `llm_usage_log`. They are ONE statement now
// (FILTER clauses over the month window), cached per tenant per UTC day, and each
// logged row adds its own contribution to the cached totals so a cap trips on the
// request after the one that crossed it rather than a cache-TTL later.

export interface TenantUsageTotals {
  dayTokens: number;
  monthTokens: number;
  paidOverflowMillicents: number;
  premiumMillicents: number;
}

const TOTALS_CACHE = { kvTtlSeconds: 60, l1TtlMs: 15_000 } as const;

export const tenantUsageTotalsCacheKey = (tenantId: number, now: Date = new Date()): string =>
  `tokusage:${tenantId}:${utcDayStart(now).toISOString().slice(0, 10)}`;

/** Day/month text tokens + today's overflow and premium spend, from one cached statement. */
export async function getTenantUsageTotals(
  env: Env | undefined,
  db: Db,
  tenantId: number,
): Promise<TenantUsageTotals> {
  return getOrSetCached(
    env,
    tenantUsageTotalsCacheKey(tenantId),
    async () => {
      const dayStart = utcDayStart();
      const [row] = await usageDatabaseOf(db)
        .select({
          month: sql<number>`COALESCE(SUM(${rowWeight}) FILTER (WHERE ${billableRow}), 0)`,
          day: sql<number>`COALESCE(SUM(${rowWeight}) FILTER (WHERE ${billableRow} AND ${llmUsageLog.createdAt} >= ${dayStart}), 0)`,
          overflow: sql<number>`COALESCE(SUM(${llmUsageLog.costUsdMillicents}) FILTER (WHERE ${llmUsageLog.paidOverflow} AND ${llmUsageLog.createdAt} >= ${dayStart}), 0)`,
          premium: sql<number>`COALESCE(SUM(${llmUsageLog.costUsdMillicents}) FILTER (WHERE ${llmUsageLog.premium} AND ${llmUsageLog.createdAt} >= ${dayStart}), 0)`,
        })
        .from(llmUsageLog)
        .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, utcMonthStart())));
      return {
        dayTokens: Number(row?.day ?? 0),
        monthTokens: Number(row?.month ?? 0),
        paidOverflowMillicents: Number(row?.overflow ?? 0),
        premiumMillicents: Number(row?.premium ?? 0),
      };
    },
    TOTALS_CACHE,
  );
}

/** The fields of a logged usage row that count toward the cap totals. */
export interface UsageRowContribution {
  llmProduct: string;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  byo: boolean;
  surface: string;
  paidOverflow: boolean;
  premium: boolean;
  costUsdMillicents: number;
}

/** Mirror of {@link rowWeight} + {@link billableRow} for ONE row, so an increment lands
 *  exactly what the SQL sum would have counted. */
export function textTokenWeightOf(r: UsageRowContribution): number {
  if ((MEDIA_PRODUCT_NAMES as readonly string[]).includes(r.llmProduct)) return 0;
  if (r.byo && (r.surface === 'on_prem' || r.surface === 'vsix')) return 0;
  return r.totalTokens - r.cacheReadTokens * (1 - CACHE_READ_MULTIPLIER) + r.cacheCreationTokens * (CACHE_CREATION_MULTIPLIER - 1);
}

/**
 * Fold a just-logged row into the tenant's cached totals. Only a WARM entry is touched:
 * on a cold miss the next load sums the table, which already includes this row, so
 * incrementing a cold read would double count.
 */
export async function addUsageToTenantTotals(env: Env, tenantId: number, r: UsageRowContribution): Promise<void> {
  const key = tenantUsageTotalsCacheKey(tenantId);
  const cached = await peekCached<TenantUsageTotals>(env, key);
  if (!cached) return;
  const weight = textTokenWeightOf(r);
  await setCached<TenantUsageTotals>(env, key, {
    dayTokens: cached.dayTokens + weight,
    monthTokens: cached.monthTokens + weight,
    paidOverflowMillicents: cached.paidOverflowMillicents + (r.paidOverflow ? r.costUsdMillicents : 0),
    premiumMillicents: cached.premiumMillicents + (r.premium ? r.costUsdMillicents : 0),
  }, TOTALS_CACHE);
}

/** Whole-token day/month figures for the request-path gate (same clamp as the SQL sums). */
export async function getTenantDayMonthTokens(env: Env | undefined, db: Db, tenantId: number): Promise<{ day: number; month: number }> {
  const t = await getTenantUsageTotals(env, db, tenantId);
  return { day: toInt(t.dayTokens), month: toInt(t.monthTokens) };
}

/** Totals for a caller holding only `env` (the cap checks shared with the cloud agent loop). */
export async function getTenantUsageTotalsForEnv(env: Env, tenantId: number): Promise<TenantUsageTotals> {
  return getTenantUsageTotals(env, resolveUsageDatabase(env, buildDatabase(env)), tenantId);
}

/**
 * Consumption-meter framework — ONE snapshot, N meters. Builds every metered
 * resource (AI tokens, data ingestion, …) into a single uniform shape so the
 * sidebar widget renders them with one card component and a new meter is added
 * here in ONE place, not as a parallel endpoint/widget/type.
 *
 * Each meter reuses its own canonical accountant + plan resolver (no second
 * definition of "usage" or "limit"): tokens → tokenUsage.ts + resolveTokenLimits;
 * ingestion → ingestionLedger.ts + resolveIngestionMonthlyBytes. So the number a
 * member SEES here equals the number ENFORCED by the gateway / ingestion gate.
 */

import { eq } from 'drizzle-orm';
import { tenants } from '../../infrastructure/database/schema';
import { buildTransactionalDatabase, type Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveAllFeatureEntitlements, type FeatureEntitlementSet } from '../tenant/featureEntitlements';
import { resolveTokenLimits, resolveIngestionMonthlyBytes, resolveErrorEventsMonthly, resolveOutboundFetchesMonthly, resolveCloudRunsMonthly, resolveStageSandboxRunsMonthly } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { dailyTenantTextTokens, utcDayStart } from '../llm/tokenUsage';
import { dailyTenantIngestionBytes, tenantIngestionBytesByProvider } from '../ingestion/ingestionLedger';
import { dailyTenantErrorEvents } from '../quality/errorEventsLedger';
import { dailyTenantOutboundFetches } from '../web/outboundFetchLedger';
import { dailyTenantCloudRuns } from '../runtime/cloudRunLedger';
import { dailyTenantStageSandboxRuns } from '../marketplace/stageSandboxLedger';
import { resolveSuperadminUnlimited } from '../llm/tenantTokenAvailability';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { utcMonthStart, utcNextMonthStart } from '../llm/tokenUsage';

export type MeterKey = 'ai_tokens' | 'ingestion' | 'error_events' | 'outbound_fetches' | 'cloud_runs' | 'stage_sandbox_runs';
export type MeterUnit = 'tokens' | 'bytes' | 'events' | 'fetches' | 'runs' | 'sandbox_runs';

export interface MeterSnapshot {
  key: MeterKey;
  unit: MeterUnit;
  used: number;
  /** Monthly allowance; -1 = unlimited. */
  limit: number;
  unlimited: boolean;
  /** Remaining this month; -1 when unlimited. */
  remaining: number;
  /** 0–100, clamped; 0 when unlimited. */
  percentUsed: number;
  /** Month-to-date daily series (one entry per elapsed UTC day) for a sparkline.
   *  Omitted for meters that don't carry a daily trend. */
  trend?: number[];
  /** Optional scoped totals beneath this meter (for example, ingestion bytes by
   * integration provider; unattributed rows can remain only in the aggregate). */
  breakdown?: Array<{ key: string; used: number }>;
}

const DAY_MS = 86_400_000;

/**
 * Densify a sparse per-day series into one value per elapsed UTC day from
 * `monthStart` through today (inclusive) — zero-filling quiet days so the
 * sparkline x-axis is evenly spaced. Returns `[total, trend]` (the day sum is the
 * meter total, so each meter needs ONE grouped scan, not a sum + a series).
 */
function densifyDaily(sparse: Array<{ day: string; value: number }>, monthStart: Date): [number, number[]] {
  const todayStart = utcDayStart();
  const days = Math.max(1, Math.floor((todayStart.getTime() - monthStart.getTime()) / DAY_MS) + 1);
  const byDay = new Map(sparse.map((r) => [r.day, r.value]));
  const trend = Array.from({ length: days }, (_, i) =>
    byDay.get(new Date(monthStart.getTime() + i * DAY_MS).toISOString().slice(0, 10)) ?? 0,
  );
  const total = sparse.reduce((a, r) => a + r.value, 0);
  return [total, trend];
}

export interface ConsumptionSnapshot {
  period: { start: string; resetsAt: string };
  plan: { effective: TenantPlan; billingStatus: TenantBillingStatus };
  meters: MeterSnapshot[];
  /**
   * Every plan feature resolved for this caller.
   *
   * Rides this snapshot rather than getting an endpoint of its own because the
   * inputs are already here — effective plan, premium override, superadmin — and
   * because the client surfaces that need it (navigation deciding which
   * destinations to show locked) are the same ones already reading the meters.
   * Without it a client can only see `plan.effective`, and turning that into a
   * feature answer means a second evaluator on the client.
   */
  features: FeatureEntitlementSet;
}

/** Assemble one meter from a raw used/limit pair (-1 limit = unlimited). */
function makeMeter(key: MeterKey, unit: MeterUnit, used: number, limit: number, trend?: number[]): MeterSnapshot {
  const unlimited = limit < 0;
  return {
    key,
    unit,
    used,
    limit,
    unlimited,
    remaining: unlimited ? -1 : Math.max(0, limit - used),
    percentUsed: unlimited || limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100)),
    ...(trend && trend.length > 0 ? { trend } : {}),
  };
}

/** Every meter's monthly allowance (-1 = unlimited). */
export interface MeterLimits {
  tokens: number;
  ingestion: number;
  errorEvents: number;
  outboundFetches: number;
  cloudRuns: number;
  stageSandboxRuns: number;
}

/**
 * Resolve all six allowances from the SAME inputs the enforcement gates use.
 * Pure, so the "what does this tenant actually get?" rule is testable without a
 * database — and `isSuperadmin` cannot be dropped again without a test failing.
 */
export function resolveMeterLimits(input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
  isSuperadmin: boolean;
}): MeterLimits {
  return {
    tokens: resolveTokenLimits(input).monthlyLimit,
    ingestion: resolveIngestionMonthlyBytes(input),
    errorEvents: resolveErrorEventsMonthly(input),
    outboundFetches: resolveOutboundFetchesMonthly(input),
    cloudRuns: resolveCloudRunsMonthly(input),
    stageSandboxRuns: resolveStageSandboxRunsMonthly(input),
  };
}

/**
 * The CACHED month-to-date snapshot the sidebar widget reads.
 *
 * 60s read-through: an aggregate scan over append-heavy ledgers that does not need
 * to be to-the-second. Keyed by tenant + calendar month so it rolls over (and
 * resets to 0) automatically at the month boundary — AND by whether the caller is
 * an unlimited superadmin operator, since that changes every limit in the payload.
 * Two entries per tenant at most, so members still share one scan; keying by user
 * instead would multiply the cache for no benefit.
 *
 * The superadmin check is resolved BEFORE the cache, not inside it, for two
 * reasons: it selects the bucket, and it must never be inherited from another
 * caller's entry — a superadmin's unlimited snapshot must not be served to a
 * capped member.
 */
export async function getConsumptionSnapshot(
  db: Db,
  env: Env,
  tenantId: number,
  actingUserId: string | null,
): Promise<ConsumptionSnapshot> {
  const monthStart = utcMonthStart();
  const monthEnd = utcNextMonthStart();
  const monthKey = monthStart.toISOString().slice(0, 7); // YYYY-MM
  const isSuperadmin = await resolveSuperadminUnlimited(db, tenantId, { actingUserId }, env);
  return getOrSetCached(
    env,
    `consumption-meter:v5:${tenantId}:${monthKey}:${isSuperadmin ? 'sa' : 'plan'}`,
    () => buildConsumptionSnapshot(db, tenantId, monthStart, monthEnd, env, { actingIsSuperadmin: isSuperadmin }),
    { kvTtlSeconds: 60, l1TtlMs: 30_000 },
  );
}

/**
 * Build the full consumption snapshot for a tenant over the given calendar month.
 * One tenant read + each meter's window-sum, fanned out in parallel.
 */
export async function buildConsumptionSnapshot(
  db: Db,
  tenantId: number,
  monthStart: Date,
  monthEnd: Date,
  env?: Env,
  /** The signed-in principal, so a SUPERADMIN operating a tenant they are not a
   *  member of sees the unlimited allowance the gate actually grants them. */
  acting?: { actingUserId?: string | null; actingIsSuperadmin?: boolean },
): Promise<ConsumptionSnapshot> {
  const ingestionDb = env?.NEON_TRANSACTIONAL_DATABASE_URL ? buildTransactionalDatabase(env) : db;
  const [tokensDaily, ingestionDaily, ingestionByProvider, errorEventsDaily, outboundFetchesDaily, cloudRunsDaily, stageSandboxRunsDaily, tenantRows] = await Promise.all([
    dailyTenantTextTokens(db, tenantId, monthStart),
    dailyTenantIngestionBytes(ingestionDb, tenantId, monthStart),
    tenantIngestionBytesByProvider(ingestionDb, tenantId, monthStart),
    dailyTenantErrorEvents(db, tenantId, monthStart),
    dailyTenantOutboundFetches(db, tenantId, monthStart),
    dailyTenantCloudRuns(db, tenantId, monthStart),
    dailyTenantStageSandboxRuns(db, tenantId, monthStart),
    db
      .select({
        plan: tenants.plan,
        billingStatus: tenants.billingStatus,
        trialEndsAt: tenants.trialEndsAt,
        tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
        premiumOverride: tenants.premiumOverride,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1),
  ]);

  const tenantRow = tenantRows[0];
  const billingStatus = (tenantRow?.billingStatus ?? 'none') as TenantBillingStatus;
  const effectivePlan = resolveEffectivePlan({
    plan: (tenantRow?.plan ?? 'free') as TenantPlan,
    billingStatus,
    trialEndsAt: tenantRow?.trialEndsAt ?? null,
  });
  const override = tenantRow?.tokenDailyLimitOverride ?? null;

  // A SUPERADMIN operator is never capped. Resolving limits here without that
  // authority made this snapshot disagree with what is actually enforced: the
  // operator was shown plain free-plan caps against real usage — "559,139,119 /
  // 50,000 · 0 left" — while every turn sailed through the gate. The meter is the
  // number members (and chat diagnostics) READ, so it resolves through the SAME
  // rule the gate uses, acting principal included.
  const isSuperadmin = await resolveSuperadminUnlimited(db, tenantId, acting, env);
  const {
    tokens: tokenLimit,
    ingestion: ingestionLimit,
    errorEvents: errorEventsLimit,
    outboundFetches: outboundFetchesLimit,
    cloudRuns: cloudRunsLimit,
    stageSandboxRuns: stageSandboxRunsLimit,
  } = resolveMeterLimits({ effectivePlan, tokenDailyLimitOverride: override, isSuperadmin });

  // Every meter comes back per-day; the month-to-date total is the day sum (one
  // grouped scan per meter does the work of the old single-total query) and the
  // dense series powers each meter's sparkline.
  const [tokensUsed, tokensTrend] = densifyDaily(tokensDaily, monthStart);
  const [ingestionUsed, ingestionTrend] = densifyDaily(ingestionDaily, monthStart);
  const [errorEventsUsed, errorEventsTrend] = densifyDaily(errorEventsDaily, monthStart);
  const [outboundFetchesUsed, outboundFetchesTrend] = densifyDaily(outboundFetchesDaily, monthStart);
  const [cloudRunsUsed, cloudRunsTrend] = densifyDaily(cloudRunsDaily, monthStart);
  const [stageSandboxRunsUsed, stageSandboxRunsTrend] = densifyDaily(stageSandboxRunsDaily, monthStart);

  return {
    period: { start: monthStart.toISOString(), resetsAt: monthEnd.toISOString() },
    plan: { effective: effectivePlan, billingStatus },
    // Same three inputs the per-route gates use, fanned over the ONE pure
    // evaluator — so a client can never disagree with what a route enforces.
    features: resolveAllFeatureEntitlements({
      effectivePlan,
      premiumOverride: tenantRow?.premiumOverride ?? false,
      isSuperadmin,
    }),
    meters: [
      makeMeter('ai_tokens', 'tokens', tokensUsed, tokenLimit, tokensTrend),
      makeMeter('cloud_runs', 'runs', cloudRunsUsed, cloudRunsLimit, cloudRunsTrend),
      makeMeter('stage_sandbox_runs', 'sandbox_runs', stageSandboxRunsUsed, stageSandboxRunsLimit, stageSandboxRunsTrend),
      { ...makeMeter('ingestion', 'bytes', ingestionUsed, ingestionLimit, ingestionTrend), breakdown: ingestionByProvider },
      makeMeter('error_events', 'events', errorEventsUsed, errorEventsLimit, errorEventsTrend),
      makeMeter('outbound_fetches', 'fetches', outboundFetchesUsed, outboundFetchesLimit, outboundFetchesTrend),
    ],
  };
}

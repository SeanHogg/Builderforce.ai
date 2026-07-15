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
import { resolveTokenLimits, resolveIngestionMonthlyBytes, resolveErrorEventsMonthly, resolveOutboundFetchesMonthly, resolveCloudRunsMonthly } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { dailyTenantTextTokens, utcDayStart } from '../llm/tokenUsage';
import { dailyTenantIngestionBytes, tenantIngestionBytesByProvider } from '../ingestion/ingestionLedger';
import { dailyTenantErrorEvents } from '../quality/errorEventsLedger';
import { dailyTenantOutboundFetches } from '../web/outboundFetchLedger';
import { dailyTenantCloudRuns } from '../runtime/cloudRunLedger';

export type MeterKey = 'ai_tokens' | 'ingestion' | 'error_events' | 'outbound_fetches' | 'cloud_runs';
export type MeterUnit = 'tokens' | 'bytes' | 'events' | 'fetches' | 'runs';

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
): Promise<ConsumptionSnapshot> {
  const ingestionDb = env?.NEON_TRANSACTIONAL_DATABASE_URL ? buildTransactionalDatabase(env) : db;
  const [tokensDaily, ingestionDaily, ingestionByProvider, errorEventsDaily, outboundFetchesDaily, cloudRunsDaily, tenantRows] = await Promise.all([
    dailyTenantTextTokens(db, tenantId, monthStart),
    dailyTenantIngestionBytes(ingestionDb, tenantId, monthStart),
    tenantIngestionBytesByProvider(ingestionDb, tenantId, monthStart),
    dailyTenantErrorEvents(db, tenantId, monthStart),
    dailyTenantOutboundFetches(db, tenantId, monthStart),
    dailyTenantCloudRuns(db, tenantId, monthStart),
    db
      .select({
        plan: tenants.plan,
        billingStatus: tenants.billingStatus,
        trialEndsAt: tenants.trialEndsAt,
        tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
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

  const { monthlyLimit: tokenLimit } = resolveTokenLimits({ effectivePlan, tokenDailyLimitOverride: override });
  const ingestionLimit = resolveIngestionMonthlyBytes({ effectivePlan, tokenDailyLimitOverride: override });
  const errorEventsLimit = resolveErrorEventsMonthly({ effectivePlan, tokenDailyLimitOverride: override });
  const outboundFetchesLimit = resolveOutboundFetchesMonthly({ effectivePlan, tokenDailyLimitOverride: override });
  const cloudRunsLimit = resolveCloudRunsMonthly({ effectivePlan, tokenDailyLimitOverride: override });

  // Every meter comes back per-day; the month-to-date total is the day sum (one
  // grouped scan per meter does the work of the old single-total query) and the
  // dense series powers each meter's sparkline.
  const [tokensUsed, tokensTrend] = densifyDaily(tokensDaily, monthStart);
  const [ingestionUsed, ingestionTrend] = densifyDaily(ingestionDaily, monthStart);
  const [errorEventsUsed, errorEventsTrend] = densifyDaily(errorEventsDaily, monthStart);
  const [outboundFetchesUsed, outboundFetchesTrend] = densifyDaily(outboundFetchesDaily, monthStart);
  const [cloudRunsUsed, cloudRunsTrend] = densifyDaily(cloudRunsDaily, monthStart);

  return {
    period: { start: monthStart.toISOString(), resetsAt: monthEnd.toISOString() },
    plan: { effective: effectivePlan, billingStatus },
    meters: [
      makeMeter('ai_tokens', 'tokens', tokensUsed, tokenLimit, tokensTrend),
      makeMeter('cloud_runs', 'runs', cloudRunsUsed, cloudRunsLimit, cloudRunsTrend),
      { ...makeMeter('ingestion', 'bytes', ingestionUsed, ingestionLimit, ingestionTrend), breakdown: ingestionByProvider },
      makeMeter('error_events', 'events', errorEventsUsed, errorEventsLimit, errorEventsTrend),
      makeMeter('outbound_fetches', 'fetches', outboundFetchesUsed, outboundFetchesLimit, outboundFetchesTrend),
    ],
  };
}

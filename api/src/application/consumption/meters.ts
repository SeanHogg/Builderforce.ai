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
import type { Db } from '../../infrastructure/database/connection';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveTokenLimits, resolveIngestionMonthlyBytes, resolveErrorEventsMonthly } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { sumTenantTextTokens } from '../llm/tokenUsage';
import { sumTenantIngestionBytes } from '../ingestion/ingestionLedger';
import { sumTenantErrorEvents } from '../quality/errorEventsLedger';

export type MeterKey = 'ai_tokens' | 'ingestion' | 'error_events';
export type MeterUnit = 'tokens' | 'bytes' | 'events';

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
}

export interface ConsumptionSnapshot {
  period: { start: string; resetsAt: string };
  plan: { effective: TenantPlan; billingStatus: TenantBillingStatus };
  meters: MeterSnapshot[];
}

/** Assemble one meter from a raw used/limit pair (-1 limit = unlimited). */
function makeMeter(key: MeterKey, unit: MeterUnit, used: number, limit: number): MeterSnapshot {
  const unlimited = limit < 0;
  return {
    key,
    unit,
    used,
    limit,
    unlimited,
    remaining: unlimited ? -1 : Math.max(0, limit - used),
    percentUsed: unlimited || limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100)),
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
): Promise<ConsumptionSnapshot> {
  const [tokensUsed, ingestionUsed, errorEventsUsed, tenantRows] = await Promise.all([
    sumTenantTextTokens(db, tenantId, monthStart),
    sumTenantIngestionBytes(db, tenantId, monthStart),
    sumTenantErrorEvents(db, tenantId, monthStart),
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

  return {
    period: { start: monthStart.toISOString(), resetsAt: monthEnd.toISOString() },
    plan: { effective: effectivePlan, billingStatus },
    meters: [
      makeMeter('ai_tokens', 'tokens', tokensUsed, tokenLimit),
      makeMeter('ingestion', 'bytes', ingestionUsed, ingestionLimit),
      makeMeter('error_events', 'events', errorEventsUsed, errorEventsLimit),
    ],
  };
}

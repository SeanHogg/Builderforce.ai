/**
 * Data-ingestion accounting — the non-token half of the consumption framework,
 * mirroring application/llm/tokenUsage.ts + usageLedger.ts.
 *
 * `recordIngestion` appends a row to ingestion_usage_log; `sumTenantIngestionBytes`
 * is THE single accountant for "bytes ingested in a window" (shared by the meter
 * and the gate); `enforceIngestionCap` is the request-path gate that pauses NEW
 * ingestion once a tenant is over its monthly allowance — graceful backpressure:
 * already-imported data stays fully usable, only fresh pulls stop.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import { ingestionUsageLog, tenants } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveSuperadminUnlimited } from '../llm/tenantTokenAvailability';
import { resolveIngestionMonthlyBytes } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { utcMonthStart } from '../llm/tokenUsage';

export interface RecordIngestionRow {
  tenantId: number;
  projectId?: number | null;
  source?: string;
  provider?: string | null;
  bytesIngested: number;
  itemsIngested?: number;
  metadata?: Record<string, unknown> | null;
}

/** Append one ingestion row. Best-effort — never throws (metering must not fail
 *  the import it's measuring). */
export async function recordIngestion(db: Db, row: RecordIngestionRow): Promise<void> {
  try {
    await db.insert(ingestionUsageLog).values({
      tenantId:      row.tenantId,
      projectId:     row.projectId ?? null,
      source:        row.source ?? 'repo_import',
      provider:      row.provider ?? null,
      bytesIngested: Math.max(0, Math.floor(row.bytesIngested)),
      itemsIngested: Math.max(0, Math.floor(row.itemsIngested ?? 0)),
      metadata:      row.metadata ? JSON.stringify(row.metadata) : null,
    });
  } catch { /* never let ingestion logging fail the request */ }
}

/** Bytes ingested by a tenant since `since` — the single window-sum the meter and
 *  the gate share. */
export async function sumTenantIngestionBytes(db: Db, tenantId: number, since: Date): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`COALESCE(SUM(${ingestionUsageLog.bytesIngested}), 0)` })
    .from(ingestionUsageLog)
    .where(and(eq(ingestionUsageLog.tenantId, tenantId), gte(ingestionUsageLog.createdAt, since)));
  return Math.max(0, Math.floor(Number(row?.used ?? 0)));
}

/** Per-day bytes ingested since `since` (UTC day buckets, sparse). Day totals sum
 *  to {@link sumTenantIngestionBytes}; drives the consumption-meter sparkline. */
export async function dailyTenantIngestionBytes(
  db: Db,
  tenantId: number,
  since: Date,
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = sql<string>`to_char(${ingestionUsageLog.createdAt}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: dayExpr, used: sql<number>`COALESCE(SUM(${ingestionUsageLog.bytesIngested}), 0)` })
    .from(ingestionUsageLog)
    .where(and(eq(ingestionUsageLog.tenantId, tenantId), gte(ingestionUsageLog.createdAt, since)))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
  return rows.map((r) => ({ day: r.day, value: Math.max(0, Math.floor(Number(r.used ?? 0))) }));
}

/** Month-to-date ingestion grouped by the integration that supplied it. Null
 * provider rows remain part of the aggregate meter but are intentionally omitted
 * here because there is no integration card to attribute them to. */
export async function tenantIngestionBytesByProvider(
  db: Db,
  tenantId: number,
  since: Date,
): Promise<Array<{ key: string; used: number }>> {
  const rows = await db
    .select({ provider: ingestionUsageLog.provider, used: sql<number>`COALESCE(SUM(${ingestionUsageLog.bytesIngested}), 0)` })
    .from(ingestionUsageLog)
    .where(and(
      eq(ingestionUsageLog.tenantId, tenantId),
      gte(ingestionUsageLog.createdAt, since),
      sql`${ingestionUsageLog.provider} IS NOT NULL`,
    ))
    .groupBy(ingestionUsageLog.provider)
    .orderBy(ingestionUsageLog.provider);
  return rows.map((r) => ({
    key: String(r.provider),
    used: Math.max(0, Math.floor(Number(r.used ?? 0))),
  }));
}

export type IngestionCapResult =
  | { allowed: true }
  | { allowed: false; effectivePlan: TenantPlan; used: number; limit: number };

/**
 * Gate NEW ingestion against the tenant's monthly byte allowance. Self-contained:
 * resolves the tenant's effective plan + limit and sums month-to-date usage, so a
 * caller only needs the tenantId. Unlimited plans (and superadmin-unlimited
 * tenants) always pass. Fails OPEN on a query error — a metering hiccup must not
 * block a legitimate import.
 */
export async function enforceIngestionCap(
  db: Db,
  tenantId: number,
  ingestionDb: Db = db,
  env?: Env,
): Promise<IngestionCapResult> {
  try {
    const [tenantRow] = await db
      .select({
        plan: tenants.plan,
        billingStatus: tenants.billingStatus,
        trialEndsAt: tenants.trialEndsAt,
        tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const effectivePlan = resolveEffectivePlan({
      plan: (tenantRow?.plan ?? 'free') as TenantPlan,
      billingStatus: (tenantRow?.billingStatus ?? 'none') as TenantBillingStatus,
      trialEndsAt: tenantRow?.trialEndsAt ?? null,
    });
    const limit = resolveIngestionMonthlyBytes({
      effectivePlan,
      tokenDailyLimitOverride: tenantRow?.tokenDailyLimitOverride ?? null,
    });
    if (limit < 0) return { allowed: true }; // plan-unlimited (Teams / -1 override)

    // A superadmin OPERATOR is unlimited on EVERY meter — same rule, same source of
    // truth as the token and cloud-run gates. Only consulted once the plan already
    // caps the tenant, so unlimited tenants pay nothing for it.
    if (await resolveSuperadminUnlimited(db, tenantId, undefined, env)) return { allowed: true };

    const used = await sumTenantIngestionBytes(ingestionDb, tenantId, utcMonthStart());
    if (used >= limit) return { allowed: false, effectivePlan, used, limit };
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

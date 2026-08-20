/**
 * Outbound-fetch accounting — the consumption-framework half of the Brain's
 * `/fetch-url` proxy, mirroring application/quality/errorEventsLedger.ts exactly.
 *
 * `sumTenantOutboundFetches` is THE single accountant for "outbound fetches in a
 * window" (shared by the consumption meter and the cap gate); `enforceOutboundFetchCap`
 * is the request-path gate that refuses NEW fetches once a tenant is over its monthly
 * allowance — graceful backpressure (the per-tenant rate limit caps burst, this caps
 * sustained volume). Count is the metered quantity (one fetch = one unit); the outbound
 * cost is the request, not the response, so we meter fetches that hit the wire.
 */

import { outboundFetchLog } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveOutboundFetchesMonthly } from '../../domain/tenant/PlanLimits';
import { enforceMonthlyTenantCap, type MonthlyTenantCapResult } from '../shared/monthlyTenantCap';
import { dailyTenantCounts, sumTenantRowCount, type DailyCount } from '../shared/dailyTenantCounts';

/** The rows that count as one billable outbound fetch. */
const OUTBOUND_FETCH_ROWS = {
  table: outboundFetchLog,
  tenantColumn: outboundFetchLog.tenantId,
  createdAtColumn: outboundFetchLog.createdAt,
} as const;

/** Record one outbound fetch (best-effort; caller waitUntils it off the hot path). */
export async function recordOutboundFetch(db: Db, tenantId: number, url: string | null): Promise<void> {
  await db.insert(outboundFetchLog).values({ tenantId, url: url ? url.slice(0, 2048) : null });
}

/** Per-day outbound-fetch count since `since` (UTC day buckets, sparse). Day totals
 *  sum to {@link sumTenantOutboundFetches}; drives the consumption-meter sparkline. */
export async function dailyTenantOutboundFetches(db: Db, tenantId: number, since: Date): Promise<DailyCount[]> {
  return dailyTenantCounts(db, tenantId, since, OUTBOUND_FETCH_ROWS);
}

/** Outbound fetches by a tenant since `since` — the single window total the meter
 *  and the gate share, over the same rows the day buckets scan. */
export async function sumTenantOutboundFetches(db: Db, tenantId: number, since: Date): Promise<number> {
  return sumTenantRowCount(db, tenantId, since, OUTBOUND_FETCH_ROWS);
}

export type OutboundFetchCapResult = MonthlyTenantCapResult;

/**
 * Gate NEW outbound fetches against the tenant's monthly allowance. Self-contained
 * (resolves plan + limit + month-to-date count from the tenantId). Unlimited plans
 * (and superadmin-unlimited tenants) always pass. Fails OPEN on a query error — a
 * metering hiccup must not block a legitimate fetch.
 */
export async function enforceOutboundFetchCap(db: Db, tenantId: number, env?: Env): Promise<OutboundFetchCapResult> {
  return enforceMonthlyTenantCap({
    db,
    tenantId,
    env,
    resolveLimit: resolveOutboundFetchesMonthly,
    sumUsage: sumTenantOutboundFetches,
  });
}

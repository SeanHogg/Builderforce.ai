/**
 * Error-event accounting — the Quality pillar's half of the consumption framework,
 * mirroring application/ingestion/ingestionLedger.ts exactly.
 *
 * `sumTenantErrorEvents` is THE single accountant for "error events ingested in a
 * window" (shared by the consumption meter and the ingest gate); `enforceErrorEventsCap`
 * is the request-path gate that pauses NEW error ingestion once a tenant is over its
 * monthly allowance — graceful backpressure: already-stored groups/events stay fully
 * usable, only fresh ingestion stops. Count is the metered quantity (one event row =
 * one unit), since error events are uniform and high-cardinality.
 */

import { errorEvents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveErrorEventsMonthly } from '../../domain/tenant/PlanLimits';
import { enforceMonthlyTenantCap, type MonthlyTenantCapResult } from '../shared/monthlyTenantCap';
import { dailyTenantCounts, sumTenantRowCount, type DailyCount } from '../shared/dailyTenantCounts';

/** The rows that count as one ingested error event, in the one place both the
 *  meter's series and the gate's total read them from. */
const ERROR_EVENT_ROWS = {
  table: errorEvents,
  tenantColumn: errorEvents.tenantId,
  createdAtColumn: errorEvents.createdAt,
} as const;

/** Per-day error-event count since `since` (UTC day buckets, sparse). Day totals
 *  sum to {@link sumTenantErrorEvents}; drives the consumption-meter sparkline. */
export async function dailyTenantErrorEvents(db: Db, tenantId: number, since: Date): Promise<DailyCount[]> {
  return dailyTenantCounts(db, tenantId, since, ERROR_EVENT_ROWS);
}

/** Error events ingested by a tenant since `since` — the single window total the
 *  meter and the gate share, over the same rows the day buckets scan. One
 *  ungrouped query: the gate is on the hottest ingest path and wants one number. */
export async function sumTenantErrorEvents(db: Db, tenantId: number, since: Date): Promise<number> {
  return sumTenantRowCount(db, tenantId, since, ERROR_EVENT_ROWS);
}

export type ErrorEventsCapResult = MonthlyTenantCapResult;

/**
 * Gate NEW error ingestion against the tenant's monthly event allowance.
 * Self-contained (resolves plan + limit + month-to-date count from the tenantId).
 * Unlimited plans (and superadmin-unlimited tenants) always pass. Fails OPEN on a
 * query error — a metering hiccup must not drop a legitimate error report.
 */
export async function enforceErrorEventsCap(db: Db, tenantId: number, env?: Env): Promise<ErrorEventsCapResult> {
  return enforceMonthlyTenantCap({
    db,
    tenantId,
    env,
    resolveLimit: resolveErrorEventsMonthly,
    sumUsage: sumTenantErrorEvents,
  });
}

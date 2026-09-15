/**
 * The runway report's cache keys.
 *
 * The report has TWO writers that change its answer: the founder declaring
 * numbers (per tenant, on write) and the finance rollup recomputing observed
 * facts (every tenant, on the sweep). Two version tokens, both folded into the
 * key, so either event invalidates without the other having to know about it —
 * and a report is never served stale between them nor recomputed between two
 * sweeps that changed nothing.
 */

export const runwayVersionKey = (tenantId: number): string => `runway:${tenantId}`;

/** Bumped once per finance rollup pass, in `cronSweeps.ts`. */
export const FINANCE_ROLLUP_VERSION_KEY = 'finance-rollup';

export const runwayReportCacheKey = (tenantVersion: string, rollupVersion: string, tenantId: number, companyId: number | null): string =>
  `finance:runway:v1:${tenantVersion}:${rollupVersion}:${tenantId}:${companyId ?? 'tenant'}`;

/** Twelve hours; the two tokens above do the real invalidation. */
export const RUNWAY_REPORT_TTL_SECONDS = 43_200;

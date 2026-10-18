/**
 * Tenant-local burn/runway snapshot — `GET /api/bi/burn-rate`, the sidebar card.
 *
 * BurnRateOS used to own these metrics and Builderforce called it over HTTP; the
 * derived finance series now live in kernel `metric_facts`. This is NOT a second
 * reader of those facts: it is the headline of the runway report's OBSERVED side
 * (`finance/runwayReport.ts`), the one place that decides which fact is "the" burn
 * (`finance.monthly_burn` over `finance.burn`) and which bucket counts (tenant-wide
 * monthly). It used to query the facts itself with its own rules — no bucket filter,
 * the opposite burn precedence — so the card and the runway page could show two
 * different monthly burns for the same tenant. Reading the report also shares its
 * cache entry with the runway page's default view.
 *
 * No host URL, token, fetch, or fallback network path is permitted here.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { runwayReport } from '../finance/runwayReport';

export interface BurnRate {
  available: boolean;
  monthlyBurn?: number;
  runwayMonths?: number;
  source?: 'builderforce';
  asOf?: string;
  reason?: 'no_data';
}

/** The newest observed monthly burn and runway, or `no_data`. */
export async function fetchBurnRate(db: Db, env: Env | undefined, tenantId: number): Promise<BurnRate> {
  const { observed } = await runwayReport(db, env, tenantId, null);
  if (observed.monthlyBurn == null && observed.runwayMonths == null) return { available: false, reason: 'no_data' };
  return {
    available: true,
    source: 'builderforce',
    ...(observed.monthlyBurn == null ? {} : { monthlyBurn: observed.monthlyBurn }),
    ...(observed.runwayMonths == null ? {} : { runwayMonths: observed.runwayMonths }),
    ...(observed.asOf ? { asOf: observed.asOf } : {}),
  };
}

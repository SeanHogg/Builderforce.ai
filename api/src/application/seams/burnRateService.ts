/**
 * Tenant-local burn/runway reader.
 *
 * BurnRateOS used to own these metrics and Builderforce called it over HTTP.
 * Consolidation moved derived finance series into kernel `metric_facts`; this
 * service now reads that owner directly. No host URL, token, fetch, or fallback
 * network path is permitted here.
 */

import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { metricFacts } from '../../infrastructure/database/schema';

const BURN_KEYS = ['finance.burn', 'finance.monthly_burn'] as const;
const RUNWAY_KEY = 'finance.runway_months';

export interface BurnRate {
  available: boolean;
  monthlyBurn?: number;
  runwayMonths?: number;
  source?: 'builderforce';
  asOf?: string;
  reason?: 'no_data';
}

export interface FetchBurnRateArgs {
  tenantId: number;
  segmentId: string;
}

/** Return the newest locally-computed value for each finance metric. */
export async function fetchBurnRate(db: Db, args: FetchBurnRateArgs): Promise<BurnRate> {
  const rows = await db
    .select({
      metric: metricFacts.metric,
      value: metricFacts.value,
      bucketAt: metricFacts.bucketAt,
      computedAt: metricFacts.computedAt,
    })
    .from(metricFacts)
    .where(and(
      eq(metricFacts.tenantId, args.tenantId),
      inArray(metricFacts.metric, [...BURN_KEYS, RUNWAY_KEY]),
      // Consolidated facts may be tenant-wide (empty dimension key) or scoped
      // to a segment. Never read a fact explicitly scoped to another segment.
      or(
        eq(metricFacts.dimensionKey, ''),
        eq(metricFacts.dimensionKey, `segment:${args.segmentId}`),
      ),
    ))
    .orderBy(desc(metricFacts.bucketAt), desc(metricFacts.computedAt))
    .limit(24);

  let monthlyBurn: number | undefined;
  let runwayMonths: number | undefined;
  let newest: Date | undefined;
  for (const row of rows) {
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    if (monthlyBurn === undefined && BURN_KEYS.includes(row.metric as typeof BURN_KEYS[number])) monthlyBurn = value;
    if (runwayMonths === undefined && row.metric === RUNWAY_KEY) runwayMonths = value;
    const at = row.computedAt ?? row.bucketAt;
    if (!newest || at > newest) newest = at;
  }

  if (monthlyBurn === undefined && runwayMonths === undefined) return { available: false, reason: 'no_data' };
  return {
    available: true,
    source: 'builderforce',
    ...(monthlyBurn === undefined ? {} : { monthlyBurn }),
    ...(runwayMonths === undefined ? {} : { runwayMonths }),
    ...(newest ? { asOf: newest.toISOString() } : {}),
  };
}

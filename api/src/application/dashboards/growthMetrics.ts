/**
 * SaaS growth metrics (PRD 25 §6.2 / §25a.3 B2).
 *
 * Each key is a whitelist entry. Until a monthly producer writes an observed
 * series, the value is the founder's declared KPI — or `null` ("Not measured"),
 * never `0`. Denominator-zero rates stay `null` because a missing declaration
 * is not a measured zero.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { metricFacts } from '../../infrastructure/database/schema/kernel';
import type { MetricDef } from './metricRegistry';
import { latestDeclaredValue } from './declaredKpi';
import { finiteOrNull } from './declaredStageKpi';

function declaredMetric(
  key: string,
  label: string,
  unit: string,
  description: string,
  goodWhenUp: boolean,
): MetricDef {
  return {
    label,
    unit,
    description,
    goodWhenUp,
    async compute(db, tenantId) {
      return latestDeclaredValue(db, tenantId, key);
    },
  };
}

/** LTV = ARPA × gross margin ÷ monthly churn. Null when any input is missing or churn is 0. */
export function ltvFromComponents(arpa: number | null, marginPct: number | null, churnPct: number | null): number | null {
  if (arpa == null || marginPct == null || churnPct == null) return null;
  if (!Number.isFinite(arpa) || !Number.isFinite(marginPct) || !Number.isFinite(churnPct)) return null;
  if (churnPct <= 0) return null;
  return (arpa * (marginPct / 100)) / (churnPct / 100);
}

/** CAC payback (months) = CAC ÷ (ARPA × gross margin). Null when monthly margin is not positive. */
export function cacPaybackFromComponents(cac: number | null, arpa: number | null, marginPct: number | null): number | null {
  if (cac == null || arpa == null || marginPct == null) return null;
  if (!Number.isFinite(cac) || !Number.isFinite(arpa) || !Number.isFinite(marginPct)) return null;
  const monthlyMargin = arpa * (marginPct / 100);
  if (monthlyMargin <= 0) return null;
  return cac / monthlyMargin;
}

/** The latest month's `revenue.*` roll-forward, as written by `rollups/revenueEconomics`. */
export interface RevenueRollForward {
  /** MRR at the end of the month (`revenue.mrr`). */
  mrr: number | null;
  newMrr: number | null;
  expansionMrr: number | null;
  contractionMrr: number | null;
  churnedMrr: number | null;
  /** Customers billed in the month (`revenue.customers`). */
  customers: number | null;
  customersLost: number | null;
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/**
 * Retention math off a month's roll-forward. Pure.
 *
 * Starting MRR is derived from the identity mrr = start + new + exp − contr − churn.
 *   NRR = (start + exp − contr − churn) / start × 100
 *   GRR = (start − contr − churn) / start × 100
 * Starting customers is `customers + customersLost` (the rollup does not publish new
 * logos, so this is an upper bound and logo churn is never overstated):
 *   logo churn = lost / startCustomers × 100
 *
 * Every rate is `null` — never `0` — when its denominator is zero or an input is absent:
 * a missing roll-forward is "Not measured", not a perfect score.
 */
export function retentionFromRollForward(rf: RevenueRollForward | null): {
  startMrr: number | null;
  nrr: number | null;
  grr: number | null;
  logoChurn: number | null;
} {
  const none = { startMrr: null, nrr: null, grr: null, logoChurn: null };
  if (!rf) return none;
  const { mrr, newMrr, expansionMrr, contractionMrr, churnedMrr, customers, customersLost } = rf;
  let nrr: number | null = null;
  let grr: number | null = null;
  let startMrr: number | null = null;
  if (finite(mrr) && finite(expansionMrr) && finite(contractionMrr) && finite(churnedMrr)) {
    startMrr = mrr - (finite(newMrr) ? newMrr : 0) - expansionMrr + contractionMrr + churnedMrr;
    if (startMrr > 0) {
      nrr = ((startMrr + expansionMrr - contractionMrr - churnedMrr) / startMrr) * 100;
      grr = ((startMrr - contractionMrr - churnedMrr) / startMrr) * 100;
    } else {
      startMrr = startMrr === 0 ? 0 : null;
    }
  }
  let logoChurn: number | null = null;
  if (finite(customers) && finite(customersLost)) {
    const startCustomers = customers + customersLost;
    if (startCustomers > 0) logoChurn = (customersLost / startCustomers) * 100;
  }
  return { startMrr, nrr, grr, logoChurn };
}

const ROLLFORWARD_KEYS = {
  mrr: 'revenue.mrr',
  newMrr: 'revenue.newMrr',
  expansionMrr: 'revenue.expansionMrr',
  contractionMrr: 'revenue.contractionMrr',
  churnedMrr: 'revenue.churnedMrr',
  customers: 'revenue.customers',
  customersLost: 'revenue.customersLost',
} as const;

/**
 * The latest month for which `revenue.mrr` exists, with the other `revenue.*` facts of
 * that SAME month. A month with MRR but no churn fact legitimately had no churn, so a
 * missing movement fact reads as 0 there — the rollup writes a movement only where rows
 * exist — while a missing `revenue.mrr` means nothing was measured at all (null).
 */
async function latestRollForward(db: Db, tenantId: number): Promise<RevenueRollForward | null> {
  const [latest] = await db
    .select({ at: metricFacts.bucketAt })
    .from(metricFacts)
    .where(and(
      eq(metricFacts.tenantId, tenantId),
      eq(metricFacts.metric, ROLLFORWARD_KEYS.mrr),
      eq(metricFacts.bucket, 'month'),
      eq(metricFacts.dimensionKey, ''),
    ))
    .orderBy(desc(metricFacts.bucketAt))
    .limit(1);
  if (!latest) return null;
  const rows = await db
    .select({ metric: metricFacts.metric, value: metricFacts.value })
    .from(metricFacts)
    .where(and(
      eq(metricFacts.tenantId, tenantId),
      inArray(metricFacts.metric, Object.values(ROLLFORWARD_KEYS)),
      eq(metricFacts.bucket, 'month'),
      eq(metricFacts.bucketAt, latest.at),
      eq(metricFacts.dimensionKey, ''),
    ));
  const byMetric = new Map(rows.map((r) => [r.metric, finiteOrNull(r.value)]));
  const get = (key: string): number | null => byMetric.get(key) ?? null;
  return {
    mrr: get(ROLLFORWARD_KEYS.mrr),
    newMrr: get(ROLLFORWARD_KEYS.newMrr) ?? 0,
    expansionMrr: get(ROLLFORWARD_KEYS.expansionMrr) ?? 0,
    contractionMrr: get(ROLLFORWARD_KEYS.contractionMrr) ?? 0,
    churnedMrr: get(ROLLFORWARD_KEYS.churnedMrr) ?? 0,
    customers: get(ROLLFORWARD_KEYS.customers),
    customersLost: get(ROLLFORWARD_KEYS.customersLost) ?? 0,
  };
}

/** A retention metric: the founder's declaration wins, else derived from `revenue.*` facts. */
function retentionMetric(
  key: string,
  label: string,
  unit: string,
  description: string,
  goodWhenUp: boolean,
  pick: (r: ReturnType<typeof retentionFromRollForward> & { mrr: number | null }) => number | null,
): MetricDef {
  return {
    label,
    unit,
    description,
    goodWhenUp,
    async compute(db, tenantId) {
      return declaredOr(db, tenantId, key, async () => {
        const rf = await latestRollForward(db, tenantId);
        return pick({ ...retentionFromRollForward(rf), mrr: rf?.mrr ?? null });
      });
    },
  };
}

async function declaredOr<T>(db: Db, tenantId: number, key: string, derive: () => Promise<T | null>): Promise<T | null> {
  const declared = await latestDeclaredValue(db, tenantId, key);
  if (declared != null) return declared as T;
  return derive();
}

export const GROWTH_METRICS: Record<string, MetricDef> = {
  'growth.mrr': retentionMetric('growth.mrr', 'MRR', 'USD', 'Monthly recurring revenue.', true, (r) => r.mrr),
  'growth.arrGrowth': declaredMetric('growth.arrGrowth', 'ARR growth', '%', 'Annualised recurring-revenue growth.', true),
  'growth.nrr': retentionMetric('growth.nrr', 'Net revenue retention', '%', 'Net revenue retention — expansion minus contraction and churn, over starting MRR.', true, (r) => r.nrr),
  'growth.grr': retentionMetric('growth.grr', 'Gross revenue retention', '%', 'Gross revenue retention — starting MRR minus contraction and churn, over starting MRR.', true, (r) => r.grr),
  'growth.grossMargin': declaredMetric('growth.grossMargin', 'Gross margin', '%', 'Gross margin after COGS, including inference where it is a cost of revenue.', true),
  'growth.cac': declaredMetric('growth.cac', 'CAC', 'USD', 'Customer acquisition cost.', false),
  'growth.cacPayback': {
    label: 'CAC payback',
    unit: 'months',
    description: 'Months of gross-margin contribution to recover CAC. Null when margin is not positive.',
    goodWhenUp: false,
    async compute(db, tenantId) {
      return declaredOr(db, tenantId, 'growth.cacPayback', async () => {
        const [cac, arpa, marginPct] = await Promise.all([
          latestDeclaredValue(db, tenantId, 'growth.cac'),
          latestDeclaredValue(db, tenantId, 'growth.mrr'),
          latestDeclaredValue(db, tenantId, 'growth.grossMargin'),
        ]);
        return cacPaybackFromComponents(cac, arpa, marginPct);
      });
    },
  },
  'growth.ltv': {
    label: 'LTV',
    unit: 'USD',
    description: 'Lifetime value from ARPA, gross margin and monthly churn. Null when churn is zero or missing.',
    goodWhenUp: true,
    async compute(db, tenantId) {
      return declaredOr(db, tenantId, 'growth.ltv', async () => {
        const [arpa, marginPct, churnPct] = await Promise.all([
          latestDeclaredValue(db, tenantId, 'growth.mrr'),
          latestDeclaredValue(db, tenantId, 'growth.grossMargin'),
          latestDeclaredValue(db, tenantId, 'growth.logoChurn'),
        ]);
        return ltvFromComponents(arpa, marginPct, churnPct);
      });
    },
  },
  'growth.ltvCac': {
    label: 'LTV:CAC',
    unit: 'x',
    description: 'Lifetime value divided by CAC. Null when CAC is zero or missing.',
    goodWhenUp: true,
    async compute(db, tenantId) {
      return declaredOr(db, tenantId, 'growth.ltvCac', async () => {
        const ltvDef = GROWTH_METRICS['growth.ltv'];
        const [ltv, cac] = await Promise.all([
          ltvDef ? ltvDef.compute(db, tenantId, 30) : Promise.resolve(null),
          latestDeclaredValue(db, tenantId, 'growth.cac'),
        ]);
        if (ltv == null || cac == null || cac <= 0) return null;
        return ltv / cac;
      });
    },
  },
  'growth.magicNumber': declaredMetric('growth.magicNumber', 'Magic number', '', 'Net new ARR divided by prior-period sales and marketing spend.', true),
  'growth.burnMultiple': declaredMetric('growth.burnMultiple', 'Burn multiple', 'x', 'Net burn divided by net new ARR. Lower is better.', false),
  'growth.logoChurn': retentionMetric('growth.logoChurn', 'Logo churn', '%', 'Monthly logo churn. Lower is better.', false, (r) => r.logoChurn),
};

/**
 * SaaS growth metrics (PRD 25 §6.2 / §25a.3 B2).
 *
 * Each key is a whitelist entry. Until a monthly producer writes an observed
 * series, the value is the founder's declared KPI — or `null` ("Not measured"),
 * never `0`. Denominator-zero rates stay `null` because a missing declaration
 * is not a measured zero.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { MetricDef } from './metricRegistry';
import { latestDeclaredValue } from './declaredKpi';

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

async function declaredOr<T>(db: Db, tenantId: number, key: string, derive: () => Promise<T | null>): Promise<T | null> {
  const declared = await latestDeclaredValue(db, tenantId, key);
  if (declared != null) return declared as T;
  return derive();
}

export const GROWTH_METRICS: Record<string, MetricDef> = {
  'growth.mrr': declaredMetric('growth.mrr', 'MRR', 'USD', 'Monthly recurring revenue.', true),
  'growth.arrGrowth': declaredMetric('growth.arrGrowth', 'ARR growth', '%', 'Annualised recurring-revenue growth.', true),
  'growth.nrr': declaredMetric('growth.nrr', 'Net revenue retention', '%', 'Net revenue retention — expansion minus contraction and churn, over starting MRR.', true),
  'growth.grr': declaredMetric('growth.grr', 'Gross revenue retention', '%', 'Gross revenue retention — starting MRR minus contraction and churn, over starting MRR.', true),
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
  'growth.logoChurn': declaredMetric('growth.logoChurn', 'Logo churn', '%', 'Monthly logo churn. Lower is better.', false),
};

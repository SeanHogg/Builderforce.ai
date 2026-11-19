/**
 * MARKET METRICS (PRD 25 Slice D) — marketplaces & consumer commerce.
 * Observed from `metric_facts`, declared from `custom_kpis`; null when neither.
 */

import type { MetricDef } from './metricRegistry';
import { observedOrDeclared, observedSum, ratioOrNull } from './declaredStageKpi';

export const MARKET_METRICS: Record<string, MetricDef> = {
  'market.gmv': {
    label: 'GMV',
    unit: 'USD',
    description: 'Gross merchandise volume in the window.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      return (await observedSum(db, tenantId, 'market.gmv', days))
        ?? observedOrDeclared(db, tenantId, 'market.gmv', days);
    },
  },
  'market.liquidity': {
    label: 'Liquidity (fill rate)',
    unit: '%',
    description: 'Requests filled divided by requests posted.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      const filled = await observedSum(db, tenantId, 'market.requests_filled', days);
      const posted = await observedSum(db, tenantId, 'market.requests_posted', days);
      const r = ratioOrNull(filled, posted);
      return r == null ? observedOrDeclared(db, tenantId, 'market.liquidity', days) : r * 100;
    },
  },
  'market.repeatRate': {
    label: 'Repeat rate (90d)',
    unit: '%',
    description: 'Buyers transacting again within 90 days.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      const repeat = await observedSum(db, tenantId, 'market.repeat_buyers', days);
      const buyers = await observedSum(db, tenantId, 'market.buyers', days);
      const r = ratioOrNull(repeat, buyers);
      return r == null ? observedOrDeclared(db, tenantId, 'market.repeatRate', days) : r * 100;
    },
  },
  'market.contributionPerOrder': {
    label: 'Contribution per order',
    unit: 'USD',
    description: 'Margin per order after payments, fulfilment and support.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      const contribution = await observedSum(db, tenantId, 'market.contribution', days);
      const orders = await observedSum(db, tenantId, 'market.orders', days);
      return ratioOrNull(contribution, orders)
        ?? observedOrDeclared(db, tenantId, 'market.contributionPerOrder', days);
    },
  },
};

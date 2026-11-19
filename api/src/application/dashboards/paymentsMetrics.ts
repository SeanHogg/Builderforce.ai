/**
 * PAYMENTS METRICS (PRD 25 Slice D) — fintech.
 * Observed from `metric_facts`, declared from `custom_kpis`; null when neither.
 */

import type { MetricDef } from './metricRegistry';
import { observedOrDeclared, observedSum, ratioOrNull } from './declaredStageKpi';

export const PAYMENTS_METRICS: Record<string, MetricDef> = {
  'payments.tpv': {
    label: 'Total payment volume',
    unit: 'USD',
    description: 'Total payment volume processed in the window.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      return (await observedSum(db, tenantId, 'payments.tpv', days))
        ?? observedOrDeclared(db, tenantId, 'payments.tpv', days);
    },
  },
  'payments.takeRate': {
    label: 'Take rate',
    unit: '%',
    description: 'Net revenue divided by TPV.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      const revenue = await observedSum(db, tenantId, 'payments.net_revenue', days);
      const tpv = await observedSum(db, tenantId, 'payments.tpv', days);
      const r = ratioOrNull(revenue, tpv);
      return r == null ? observedOrDeclared(db, tenantId, 'payments.takeRate', days) : r * 100;
    },
  },
  'payments.fundedAccountRatio': {
    label: 'Funded-account ratio',
    unit: '%',
    description: 'Accounts with a balance or first transaction divided by sign-ups.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      const funded = await observedSum(db, tenantId, 'payments.funded_accounts', days);
      const signups = await observedSum(db, tenantId, 'payments.signups', days);
      const r = ratioOrNull(funded, signups);
      return r == null ? observedOrDeclared(db, tenantId, 'payments.fundedAccountRatio', days) : r * 100;
    },
  },
  'payments.fraudLossBps': {
    label: 'Fraud loss rate',
    unit: 'bps',
    description: 'Confirmed fraud losses divided by TPV, in basis points.',
    goodWhenUp: false,
    async compute(db, tenantId, days) {
      const loss = await observedSum(db, tenantId, 'payments.fraud_loss', days);
      const tpv = await observedSum(db, tenantId, 'payments.tpv', days);
      const r = ratioOrNull(loss, tpv);
      return r == null ? observedOrDeclared(db, tenantId, 'payments.fraudLossBps', days) : r * 10_000;
    },
  },
  'payments.payoutLatency': {
    label: 'Payout latency',
    unit: 'hours',
    description: 'Hours from payout initiation to funds available.',
    goodWhenUp: false,
    compute: (db, tenantId, days) => observedOrDeclared(db, tenantId, 'payments.payoutLatency', days),
  },
};

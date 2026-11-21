import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { METRIC_REGISTRY, isMetricKey } from './metricRegistry';
import { AI_METRICS } from './aiMetrics';
import {
  GROWTH_METRICS,
  cacPaybackFromComponents,
  ltvFromComponents,
  retentionFromRollForward,
  type RevenueRollForward,
} from './growthMetrics';

/** A db whose every query resolves to no rows — nothing declared. */
function emptyDb(): Db {
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([]);
      return () => self;
    },
  });
  return self as unknown as Db;
}

describe('Slice B metric keys', () => {
  const required = [
    'growth.mrr', 'growth.arrGrowth', 'growth.nrr', 'growth.grr', 'growth.grossMargin',
    'growth.cac', 'growth.cacPayback', 'growth.ltv', 'growth.ltvCac', 'growth.magicNumber',
    'growth.burnMultiple', 'growth.logoChurn',
    'ai.inferenceMarginPct', 'ai.inferenceCostPerUnit', 'ai.inferenceEfficiency',
  ];

  it('whitelists every §6.2 growth and AI key', () => {
    for (const key of required) {
      expect(isMetricKey(key), key).toBe(true);
      expect(METRIC_REGISTRY[key], key).toBeDefined();
    }
    expect(METRIC_REGISTRY['growth.nrr']).toBe(GROWTH_METRICS['growth.nrr']);
    expect(METRIC_REGISTRY['ai.inferenceMarginPct']).toBe(AI_METRICS['ai.inferenceMarginPct']);
  });

  it('returns null — never 0 — when nothing is declared', async () => {
    const db = emptyDb();
    for (const key of required) {
      expect(await METRIC_REGISTRY[key]!.compute(db, 1, 30), key).toBeNull();
    }
  });
});

/** A db whose select chain resolves to `rows` in order, one array per awaited query. */
function sequencedDb(results: unknown[][]): Db {
  let i = 0;
  const self: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        const rows = results[i++] ?? [];
        return (resolve: (v: unknown) => void) => resolve(rows);
      }
      return () => self;
    },
  });
  return self as Db;
}

describe('retention derived from revenue.* facts', () => {
  // start = 1000 − 200(new) − 100(exp) + 50(contr) + 150(churn) = 900
  const rf: RevenueRollForward = {
    mrr: 1000, newMrr: 200, expansionMrr: 100, contractionMrr: 50, churnedMrr: 150,
    customers: 9, customersLost: 1,
  };

  it('computes NRR, GRR and logo churn', () => {
    const r = retentionFromRollForward(rf);
    expect(r.startMrr).toBeCloseTo(900);
    expect(r.nrr).toBeCloseTo(((900 + 100 - 50 - 150) / 900) * 100);
    expect(r.grr).toBeCloseTo(((900 - 50 - 150) / 900) * 100);
    expect(r.logoChurn).toBeCloseTo(10);
  });

  it('returns null — never 0 — on zero starting MRR, zero customers, or no roll-forward', () => {
    const zeroStart = retentionFromRollForward({
      mrr: 100, newMrr: 100, expansionMrr: 0, contractionMrr: 0, churnedMrr: 0, customers: 1, customersLost: 0,
    });
    expect(zeroStart.nrr).toBeNull();
    expect(zeroStart.grr).toBeNull();
    const noCustomers = retentionFromRollForward({ ...rf, customers: 0, customersLost: 0 });
    expect(noCustomers.logoChurn).toBeNull();
    expect(retentionFromRollForward(null)).toEqual({ startMrr: null, nrr: null, grr: null, logoChurn: null });
  });

  it('prefers a declared value over the derived one', async () => {
    const db = sequencedDb([[{ target: '123.5' }]]);
    expect(await GROWTH_METRICS['growth.nrr']!.compute(db, 1, 30)).toBe(123.5);
  });

  it('derives from the latest revenue.* facts when nothing is declared', async () => {
    const at = new Date('2026-10-01');
    const db = sequencedDb([
      [], // no declaration
      [{ at }], // latest revenue.mrr month
      [
        { metric: 'revenue.mrr', value: '1000' },
        { metric: 'revenue.newMrr', value: '200' },
        { metric: 'revenue.expansionMrr', value: '100' },
        { metric: 'revenue.contractionMrr', value: '50' },
        { metric: 'revenue.churnedMrr', value: '150' },
        { metric: 'revenue.customers', value: '9' },
        { metric: 'revenue.customersLost', value: '1' },
      ],
    ]);
    const nrr = await GROWTH_METRICS['growth.nrr']!.compute(db, 1, 30);
    expect(nrr).toBeCloseTo(((900 + 100 - 50 - 150) / 900) * 100);
  });
});

describe('growth formulas', () => {
  it('computes LTV and returns null on zero or missing churn', () => {
    expect(ltvFromComponents(100, 80, 2)).toBeCloseTo(4_000);
    expect(ltvFromComponents(100, 80, 0)).toBeNull();
    expect(ltvFromComponents(100, 80, null)).toBeNull();
    expect(ltvFromComponents(null, 80, 2)).toBeNull();
  });

  it('computes CAC payback and returns null when monthly margin is not positive', () => {
    expect(cacPaybackFromComponents(400, 100, 80)).toBeCloseTo(5);
    expect(cacPaybackFromComponents(400, 100, 0)).toBeNull();
    expect(cacPaybackFromComponents(400, 0, 80)).toBeNull();
    expect(cacPaybackFromComponents(null, 100, 80)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { METRIC_REGISTRY, isMetricKey } from './metricRegistry';
import { AI_METRICS } from './aiMetrics';
import {
  GROWTH_METRICS,
  cacPaybackFromComponents,
  ltvFromComponents,
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

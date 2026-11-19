import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { METRIC_REGISTRY, isMetricKey } from './metricRegistry';
import { CLINICAL_METRICS, CLINICAL_STAGES, REIMBURSEMENT_STAGES } from './clinicalMetrics';
import { PAYMENTS_METRICS } from './paymentsMetrics';
import { CLIMATE_METRICS } from './climateMetrics';
import { HARDWARE_METRICS, PRODUCTION_STAGES } from './hardwareMetrics';
import { SECURITY_METRICS } from './securityMetrics';
import { MARKET_METRICS } from './marketMetrics';
import { finiteOrNull, ratioOrNull, stageLabel } from './declaredStageKpi';

/** A db whose every query resolves to no rows — "nothing observed, nothing declared". */
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

/** A db that answers every query with one row carrying the given value everywhere. */
function constDb(value: string | number): Db {
  const row = { value, target: value, total: value, n: 1 };
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([row]);
      return () => self;
    },
  });
  return self as unknown as Db;
}

const ALL = {
  ...CLINICAL_METRICS, ...PAYMENTS_METRICS, ...CLIMATE_METRICS,
  ...HARDWARE_METRICS, ...SECURITY_METRICS, ...MARKET_METRICS,
};

describe('Slice D metric families', () => {
  it('declares every §6.2 key and whitelists it in the registry', () => {
    const required = [
      'clinical.stage', 'clinical.monthsToMilestone', 'clinical.regulatorySpendPct',
      'clinical.costPerDataPoint', 'clinical.enrollmentRate', 'clinical.reimbursementStatus',
      'payments.tpv', 'payments.takeRate', 'payments.fundedAccountRatio', 'payments.fraudLossBps', 'payments.payoutLatency',
      'climate.unitCostVsIncumbent', 'climate.tco2eAbated', 'climate.capacityDeployed', 'climate.offtakePipeline',
      'hardware.bomCost', 'hardware.grossMargin', 'hardware.backlog', 'hardware.productionStage',
      'security.pipelineCoverage', 'security.pocConversion', 'security.timeToValue',
      'market.gmv', 'market.liquidity', 'market.repeatRate', 'market.contributionPerOrder',
    ];
    for (const key of required) {
      expect(ALL[key], key).toBeDefined();
      expect(isMetricKey(key), key).toBe(true);
      expect(METRIC_REGISTRY[key]).toBe(ALL[key]);
    }
  });

  it('returns null — never 0 — for every metric when nothing is measured or declared', async () => {
    const db = emptyDb();
    for (const [key, def] of Object.entries(ALL)) {
      expect(await def.compute(db, 1, 30), key).toBeNull();
    }
  });

  it('carries stages as data on every stage-unit metric, and only those', () => {
    for (const [key, def] of Object.entries(ALL)) {
      if (def.unit === 'stage') expect(def.stages?.length, key).toBeGreaterThan(1);
      else expect(def.stages, key).toBeUndefined();
    }
    expect(CLINICAL_METRICS['clinical.stage']!.stages).toBe(CLINICAL_STAGES);
    expect(CLINICAL_METRICS['clinical.reimbursementStatus']!.stages).toBe(REIMBURSEMENT_STAGES);
    expect(HARDWARE_METRICS['hardware.productionStage']!.stages).toBe(PRODUCTION_STAGES);
  });

  it('reads a stage ordinal from a declared value and rejects out-of-range ordinals', async () => {
    const stage = HARDWARE_METRICS['hardware.productionStage']!;
    expect(await stage.compute(constDb(2), 1, 30)).toBe(2);
    expect(await stage.compute(constDb(99), 1, 30)).toBeNull();
    expect(await stage.compute(constDb(1.5), 1, 30)).toBeNull();
    expect(await stage.compute(constDb(-1), 1, 30)).toBeNull();
  });

  it('computes ratios from observed facts and null on a zero denominator', async () => {
    // numerator and denominator both 50 → take rate 100%
    expect(await PAYMENTS_METRICS['payments.takeRate']!.compute(constDb(50), 1, 30)).toBe(100);
    // 0 TPV → denominator zero → falls through to declared 0? declared value is 0 here, so it is a
    // real declared value; the ratio itself must not divide by zero.
    expect(ratioOrNull(5, 0)).toBeNull();
    expect(ratioOrNull(null, 3)).toBeNull();
    expect(ratioOrNull(3, null)).toBeNull();
    expect(ratioOrNull(1, 4)).toBe(0.25);
  });
});

describe('declaredStageKpi helpers', () => {
  it('finiteOrNull rejects null, NaN and non-numeric strings', () => {
    expect(finiteOrNull(null)).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
    expect(finiteOrNull('abc')).toBeNull();
    expect(finiteOrNull('3.5')).toBe(3.5);
    expect(finiteOrNull(0)).toBe(0);
  });

  it('stageLabel maps an ordinal and tolerates null / out of range', () => {
    expect(stageLabel(PRODUCTION_STAGES, 0)).toBe('prototype');
    expect(stageLabel(PRODUCTION_STAGES, null)).toBeNull();
    expect(stageLabel(PRODUCTION_STAGES, 10)).toBeNull();
  });
});

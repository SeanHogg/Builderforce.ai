import { describe, expect, it } from 'vitest';
import {
  asFraction,
  computeMarketSize,
  marketSizeVerdicts,
  summarizeMarketSize,
} from './marketSize';

describe('marketSize derive', () => {
  // Hand arithmetic: ARPA $1,000/yr. Potential 100,000 → TAM $100M. Serviceable 20,000 → SAM $20M.
  // Reachable 5,000 × $1,000 × 10% → SOM $500k. Top-down: $200M × 0.25% (=0.0025) → $500k.
  const base = {
    potentialCustomers: 100_000,
    serviceableCustomers: 20_000,
    reachableCustomers: 5_000,
    arpa: 1_000,
    achievableShare: 0.1,
    topDownMarket: 200_000_000,
    topDownShare: 0.0025,
  };

  it('derives TAM, SAM, SOM and the top-down figure', () => {
    const f = computeMarketSize(base);
    expect(f.tam).toBe(100_000_000);
    expect(f.sam).toBe(20_000_000);
    expect(f.som).toBe(500_000);
    expect(f.topDownSom).toBe(500_000);
    expect(f.triangulationGap).toBe(0);
  });

  it('returns undefined — never 0 — on missing inputs', () => {
    expect(computeMarketSize({})).toEqual({});
    const f = computeMarketSize({ potentialCustomers: 10 });
    expect(f.tam).toBeUndefined();
    expect(f.sam).toBeUndefined();
    expect(f.som).toBeUndefined();
    expect(f.triangulationGap).toBeUndefined();
  });

  it('reads whole-percentage shares as fractions', () => {
    expect(asFraction(5)).toBe(0.05);
    expect(asFraction(0.05)).toBe(0.05);
    expect(asFraction('')).toBeUndefined();
    expect(asFraction(-1)).toBeUndefined();
    expect(summarizeMarketSize({ ...base, achievableShare: 10 }).som).toBe(500_000);
  });

  it('flags som <= sam <= tam violations as inconsistent', () => {
    const bad = summarizeMarketSize({ ...base, serviceableCustomers: 200_000 });
    expect(bad.sam).toBeGreaterThan(bad.tam!);
    expect(bad.verdicts).toContain('inconsistent');
    expect(bad.inconsistent).toBe(true);
    const bad2 = summarizeMarketSize({ ...base, reachableCustomers: 50_000, achievableShare: 1 });
    expect(bad2.som!).toBeGreaterThan(bad2.sam!);
    expect(bad2.inconsistent).toBe(true);
    expect(summarizeMarketSize(base).inconsistent).toBe(false);
  });

  it('marks two methods within 15% as triangulated, beyond as divergent', () => {
    // top-down 560k vs bottom-up 500k → gap 60/560 ≈ 10.7%
    const near = summarizeMarketSize({ ...base, topDownMarket: 224_000_000 });
    expect(near.triangulationGap!).toBeCloseTo(0.107, 2);
    expect(near.verdicts).toContain('triangulated');
    // top-down 1M vs 500k → gap 50%
    const far = summarizeMarketSize({ ...base, topDownMarket: 400_000_000 });
    expect(far.verdicts).toContain('divergent');
  });

  it('judges only what exists', () => {
    expect(marketSizeVerdicts({})).toEqual([]);
    expect(marketSizeVerdicts({ tam: 10 })).toEqual([]);
    expect(marketSizeVerdicts({ sam: 5, tam: 10 })).toEqual(['consistent']);
  });
});

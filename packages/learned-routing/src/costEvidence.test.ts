import { describe, expect, it } from 'vitest';
import { compareAvgCost, hasCostMean } from './costEvidence.js';

describe('costEvidence', () => {
  it('reads a stat with no costN as priced (blobs written before cost could be unknown)', () => {
    expect(hasCostMean({})).toBe(true);
    expect(hasCostMean({ costN: 3 })).toBe(true);
    expect(hasCostMean({ costN: 0 })).toBe(false);
  });

  it('compares cheaper-first only when both know their cost', () => {
    expect(compareAvgCost({ avgCostMc: 5, costN: 1 }, { avgCostMc: 9, costN: 1 })).toBeLessThan(0);
    expect(compareAvgCost({ avgCostMc: 0, costN: 0 }, { avgCostMc: 9, costN: 1 })).toBe(0);
    expect(compareAvgCost({ avgCostMc: 5, costN: 1 }, { avgCostMc: 0, costN: 0 })).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import type { ReplayImpactDto } from '@builderforce/interaction-contract';
import { rankPrescriptions, rankScore } from './rank';

const impact = (estimate: number | null, confidence: ReplayImpactDto['confidence'], high: number | null = null): ReplayImpactDto =>
  ({ estimate, low: null, high, unit: 'conversions', confidence, horizonDays: 30, estimated: false });

describe('rankPrescriptions', () => {
  it('orders by impact ÷ effort', () => {
    const ranked = rankPrescriptions([
      { key: 'a', impact: impact(30, 'medium'), effort: 3, affected: 10 }, // 10
      { key: 'b', impact: impact(24, 'medium'), effort: 1, affected: 10 }, // 24
      { key: 'c', impact: impact(40, 'high'), effort: 2, affected: 10 },   // 20
    ]);
    expect(ranked.map((r) => r.key)).toEqual(['b', 'c', 'a']);
  });

  it('puts every low-confidence finding after the measured ones, however big', () => {
    const ranked = rankPrescriptions([
      { key: 'guess', impact: impact(null, 'low', 900), effort: 1, affected: 5_000 },
      { key: 'measured', impact: impact(2, 'medium'), effort: 3, affected: 10 },
    ]);
    expect(ranked.map((r) => r.key)).toEqual(['measured', 'guess']);
  });

  it('ranks low-confidence findings by their range top, else by visits touched, and breaks ties on the key', () => {
    expect(rankScore({ key: 'x', impact: impact(null, 'low', 12), effort: 2, affected: 99 })).toBe(6);
    expect(rankScore({ key: 'x', impact: impact(null, 'low', null), effort: 1, affected: 40 })).toBe(40);
    const tied = rankPrescriptions([
      { key: 'z', impact: impact(5, 'medium'), effort: 1, affected: 1 },
      { key: 'y', impact: impact(5, 'medium'), effort: 1, affected: 1 },
    ]);
    expect(tied.map((r) => r.key)).toEqual(['y', 'z']);
  });
});

import { describe, expect, it } from 'vitest';
import { estimateImpact, minimumSampleFor, MIN_COHORT_VISITS, wilsonInterval } from './impact';

describe('wilsonInterval', () => {
  it('brackets the observed rate and stays inside [0, 1]', () => {
    const { low, high } = wilsonInterval(50, 1_000);
    expect(low).toBeLessThan(0.05);
    expect(high).toBeGreaterThan(0.05);
    expect(low).toBeCloseTo(0.0381, 3);
    expect(high).toBeCloseTo(0.0653, 3);
    expect(wilsonInterval(0, 10).low).toBeCloseTo(0, 10);
    expect(wilsonInterval(10, 10).high).toBeCloseTo(1, 10);
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe('estimateImpact', () => {
  const cohorts = (withVisits: number, withConv: number, withoutVisits: number, withoutConv: number, estimated = false) => ({
    with: { visits: withVisits, conversions: withConv },
    without: { visits: withoutVisits, conversions: withoutConv },
    estimated,
  });

  it('is affected × (rate without − rate with), projected from the window to 30 days, inside its Wilson range', () => {
    // 600 affected in a 15-day window → 1 200 in 30 days; 5% − 2% = 3 points → 36 conversions.
    const impact = estimateImpact({ affected: 600 }, cohorts(600, 12, 2_000, 100), 15);
    expect(impact.estimate).toBe(36);
    expect(impact.low).not.toBeNull();
    expect(impact.high).not.toBeNull();
    expect(impact.low!).toBeLessThan(36);
    expect(impact.high!).toBeGreaterThan(36);
    expect(impact).toMatchObject({ unit: 'conversions', horizonDays: 30, confidence: 'medium', estimated: false });
  });

  it('withholds the point estimate and says low confidence below 100 visits in either cohort', () => {
    const small = estimateImpact({ affected: 99 }, cohorts(MIN_COHORT_VISITS - 1, 1, 5_000, 250), 30);
    expect(small.estimate).toBeNull();
    expect(small.confidence).toBe('low');
    expect(estimateImpact({ affected: 500 }, cohorts(500, 5, MIN_COHORT_VISITS - 1, 5), 30).estimate).toBeNull();
  });

  it('is high confidence only with big cohorts and a range clear of zero', () => {
    expect(estimateImpact({ affected: 2_000 }, cohorts(2_000, 20, 5_000, 300), 30).confidence).toBe('high');
    expect(estimateImpact({ affected: 2_000 }, cohorts(2_000, 100, 5_000, 255), 30).confidence).toBe('medium');
  });

  it('has no estimate without cohorts, and carries the ≈ flag of kept-recording cohorts', () => {
    expect(estimateImpact({ affected: 10 }, null, 30)).toEqual({
      estimate: null, low: null, high: null, unit: 'conversions', confidence: 'low', horizonDays: 30, estimated: false,
    });
    expect(estimateImpact({ affected: 300 }, cohorts(300, 3, 900, 45, true), 30).estimated).toBe(true);
  });
});

describe('minimumSampleFor', () => {
  it('sizes a test from the cohorts (16·p(1−p)/δ²), clamped, with a default when unknown', () => {
    expect(minimumSampleFor({ with: { visits: 1_000, conversions: 20 }, without: { visits: 1_000, conversions: 50 }, estimated: false })).toBe(845);
    expect(minimumSampleFor(null)).toBe(1_000);
    expect(minimumSampleFor({ with: { visits: 1_000, conversions: 499 }, without: { visits: 1_000, conversions: 500 }, estimated: false })).toBe(50_000);
  });
});

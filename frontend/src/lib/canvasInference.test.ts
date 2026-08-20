import { describe, expect, it } from 'vitest';
import { meanInterval, normalCdf, proportionInterval, scoreExperiment, twoProportionTest } from './canvasInference';

describe('canvasInference', () => {
  it('approximates the normal CDF to well inside display precision', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 5);
  });

  it('gives a proportion interval WIDTH at the boundary, where Wald gives zero', () => {
    // 0 conversions out of 40 is the case that makes the textbook interval useless:
    // it reports 0% ± 0% and reads as certainty. Wilson stays honest.
    const interval = proportionInterval(0, 40)!;
    expect(interval.low).toBe(0);
    expect(interval.high).toBeGreaterThan(0.05);
  });

  it('keeps a proportion interval inside [0,1]', () => {
    const interval = proportionInterval(40, 40)!;
    expect(interval.low).toBeGreaterThan(0.8);
    expect(interval.high).toBe(1);
  });

  it('refuses a mean interval below two observations rather than inventing one', () => {
    expect(meanInterval([5])).toBeNull();
    const interval = meanInterval([10, 12, 14, 16, 18])!;
    expect(interval.mean).toBe(14);
    expect(interval.sampleSize).toBe(5);
    expect(interval.low).toBeLessThan(14);
    expect(interval.high).toBeGreaterThan(14);
  });

  it('finds a large, well-powered difference significant', () => {
    const test = twoProportionTest(100, 1000, 200, 1000)!;
    expect(test.baseRate).toBe(0.1);
    expect(test.variantRate).toBe(0.2);
    expect(test.absoluteLift).toBe(0.1);
    expect(test.relativeLift).toBe(1);
    expect(test.pValue).toBeLessThan(0.001);
    expect(test.significant).toBe(true);
    expect(test.power).toBeGreaterThan(0.9);
  });

  it('reports an underpowered null result as underpowered, not as no effect', () => {
    // The whole reason power travels with the p-value: without it, "not significant"
    // reads as "no difference" when it actually means "not enough data".
    const test = twoProportionTest(5, 50, 8, 50)!;
    expect(test.significant).toBe(false);
    expect(test.power).toBeLessThan(0.5);
    expect(test.requiredSampleSize).toBeGreaterThan(50);
  });

  it('keeps the interval and the verdict agreeing about the same data', () => {
    // Pooled error for the test, unpooled for the interval — using one for both is the
    // classic hand-rolled A/B error and makes these two disagree.
    const significant = twoProportionTest(100, 1000, 200, 1000)!;
    expect(significant.interval.low).toBeGreaterThan(0);
    const notSignificant = twoProportionTest(100, 1000, 105, 1000)!;
    expect(notSignificant.significant).toBe(false);
    expect(notSignificant.interval.low).toBeLessThan(0);
  });

  it('rejects impossible arms instead of returning a number', () => {
    expect(twoProportionTest(10, 5, 1, 10)).toBeNull();
    expect(twoProportionTest(1, 0, 1, 10)).toBeNull();
  });

  it('scores an experiment against its first variant and keeps a zero-exposure arm visible', () => {
    const scored = scoreExperiment([
      { variant: 'control', exposure: 1000, conversion: 100 },
      { variant: 'treatment', exposure: 1000, conversion: 200 },
      { variant: 'broken', exposure: 0, conversion: 0 },
    ]);
    expect(scored[0].control).toBe(true);
    expect(scored[0].test).toBeNull();
    expect(scored[1].test!.significant).toBe(true);
    // Dropping the arm that got no traffic is how a broken split looks like a clean run.
    expect(scored[2].rate).toBeNull();
    expect(scored[2].variant).toBe('broken');
  });
});

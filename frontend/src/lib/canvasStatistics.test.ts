import { describe, expect, it } from 'vitest';
import { correlation, histogram, linearFit, mean, median, mode, percentile, stddev, summarize, variance, zScores } from './canvasStatistics';

describe('canvasStatistics', () => {
  it('interpolates percentiles the way NumPy and Excel do', () => {
    // The nearest-rank alternative would return 10 for p95 here — the maximum — and so
    // would report the same number for two very differently shaped tails.
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.5)).toBe(5.5);
    expect(percentile(values, 0.25)).toBe(3.25);
    expect(percentile(values, 0.95)).toBe(9.55);
  });

  it('clamps a fraction outside [0,1] rather than throwing', () => {
    expect(percentile([1, 2, 3], 1.5)).toBe(3);
    expect(percentile([1, 2, 3], -1)).toBe(1);
  });

  it('returns null for statistics that are undefined, never 0', () => {
    // A zero that means "no data" is how an empty group renders as a confident reading.
    expect(median([])).toBeNull();
    expect(stddev([5])).toBeNull();
    expect(variance([5])).toBeNull();
    expect(mean([])).toBeNull();
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('uses the sample divisor, not the population one', () => {
    // n-1 = 2.5; the population divisor would give 2 and understate every interval
    // built on top of it.
    expect(variance([1, 2, 3, 4, 5])).toBe(2.5);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2.13809);
  });

  it('computes correlation and recognises perfect relationships', () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBe(1);
    expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBe(-1);
  });

  it('summarises a distribution with Tukey fences', () => {
    const summary = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(summary).toMatchObject({ count: 10, min: 1, max: 100, median: 5.5 });
    expect(summary!.outlierHigh).toBeLessThan(100);
  });

  it('bins a distribution and keeps the maximum inside the last bin', () => {
    const bins = histogram([1, 2, 2, 3, 3, 3, 4, 4, 5, 20]);
    expect(bins.length).toBeGreaterThan(0);
    expect(bins.reduce((total, bin) => total + bin.count, 0)).toBe(10);
    expect(bins[bins.length - 1].end).toBe(20);
  });

  it('collapses a constant column to one bin instead of dividing by zero', () => {
    expect(histogram([7, 7, 7])).toEqual([{ start: 7, end: 7, count: 3, label: '7' }]);
  });

  it('breaks a mode tie deterministically, toward the smaller value', () => {
    expect(mode([3, 3, 1, 1, 2])).toBe(1);
  });

  it('fits a line and reports how well it fits', () => {
    expect(linearFit([2, 4, 6, 8])).toEqual({ slope: 2, intercept: 2, r2: 1 });
    expect(linearFit([1])).toBeNull();
  });

  it('returns zeroes rather than NaNs for a column with no spread', () => {
    // A NaN here propagates into a chart as a blank the user cannot explain.
    expect(zScores([5, 5, 5])).toEqual([0, 0, 0]);
  });

  it('does not reorder the caller array', () => {
    const values = [3, 1, 2];
    median(values);
    summarize(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

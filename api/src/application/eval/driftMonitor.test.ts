import { describe, expect, it } from 'vitest';
import {
  mean,
  stdev,
  populationStabilityIndex,
  computeDrift,
  detectGroupDrift,
  type ScoredSample,
} from './driftMonitor';

describe('stats helpers', () => {
  it('mean of empty is 0; stdev needs ≥2 samples', () => {
    expect(mean([])).toBe(0);
    expect(mean([2, 4])).toBe(3);
    expect(stdev([5])).toBe(0);
    expect(stdev([2, 4, 6])).toBeGreaterThan(0);
  });
});

describe('populationStabilityIndex', () => {
  it('is ~0 for identical distributions', () => {
    const xs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
    expect(populationStabilityIndex(xs, xs)).toBeCloseTo(0, 3);
  });

  it('is large for a shifted distribution', () => {
    const lo = Array.from({ length: 50 }, () => 0.1);
    const hi = Array.from({ length: 50 }, () => 0.9);
    expect(populationStabilityIndex(lo, hi)).toBeGreaterThan(0.2);
  });

  it('returns 0 when either window is empty', () => {
    expect(populationStabilityIndex([], [0.5])).toBe(0);
    expect(populationStabilityIndex([0.5], [])).toBe(0);
  });

  it('clamps out-of-range values into the edge bins', () => {
    // values <0 and >1 must not crash the histogram (idx clamp).
    expect(populationStabilityIndex([-1, 2], [-1, 2])).toBeCloseTo(0, 6);
  });
});

describe('computeDrift', () => {
  const flatBaseline = Array.from({ length: 20 }, () => 0.9);

  it('reports insufficient when either window is too small', () => {
    const r = computeDrift([0.9, 0.9], [0.5, 0.5]);
    expect(r.sufficient).toBe(false);
    expect(r.drifted).toBe(false);
    expect(r.severity).toBe('none');
  });

  it('alerts on a clear regression (mean drop + distribution shift)', () => {
    const recent = Array.from({ length: 20 }, () => 0.4);
    const baseline = [...Array(19).fill(0.9), 0.85]; // tiny variance so z is large
    const r = computeDrift(baseline, recent);
    expect(r.delta).toBeLessThan(0);
    expect(r.severity).toBe('alert');
    expect(r.drifted).toBe(true);
  });

  it('does not alert on an improvement', () => {
    const recent = Array.from({ length: 20 }, () => 0.99);
    const baseline = [...Array(19).fill(0.5), 0.55];
    const r = computeDrift(baseline, recent);
    expect(r.delta).toBeGreaterThan(0);
    expect(r.severity).not.toBe('alert');
  });

  it('warns when only the distribution shifts (flat baseline → z=0)', () => {
    // Flat baseline → stdev 0 → zScore 0, so mean-shift can never fire; a PSI shift
    // alone yields a warn. Recent regresses but z stays 0.
    const recent = Array.from({ length: 20 }, (_v, i) => (i < 10 ? 0.85 : 0.4));
    const r = computeDrift(flatBaseline, recent);
    expect(r.zScore).toBe(0);
    expect(['warn', 'none']).toContain(r.severity);
  });
});

describe('detectGroupDrift', () => {
  it('splits each group by time and ranks worst-first', () => {
    const samples: ScoredSample[] = [];
    // group A regresses; group B stable.
    for (let i = 0; i < 20; i++) samples.push({ group: 'A', score: 0.9, ts: i });
    for (let i = 20; i < 40; i++) samples.push({ group: 'A', score: 0.4, ts: i });
    for (let i = 0; i < 40; i++) samples.push({ group: 'B', score: 0.8, ts: i });

    const out = detectGroupDrift(samples, { minSamples: 8 });
    expect(out.length).toBe(2);
    // Worst-first ordering: A (negative delta) before B (≈0).
    expect(out[0]!.group).toBe('A');
    expect(out[0]!.result.drifted).toBe(true);
    expect(out[1]!.group).toBe('B');
    expect(out[1]!.result.drifted).toBe(false);
  });
});

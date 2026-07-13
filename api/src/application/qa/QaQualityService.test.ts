import { describe, it, expect } from 'vitest';
import { summarizeProducers } from './QaQualityService';

const row = (over: Partial<{ key: string | null; runs: number; avgScore: number; merged: number; ciGreen: number; degraded: number }> = {}) => ({
  key: 'claude-opus-4-8', runs: 10, avgScore: 0.8, merged: 8, ciGreen: 9, degraded: 0, ...over,
});

describe('summarizeProducers', () => {
  it('derives merge/ci/degraded rates and defect counts', () => {
    const r = summarizeProducers([row({ runs: 10, merged: 7, ciGreen: 6, degraded: 2, avgScore: 0.7 })])[0]!;
    expect(r.mergedRate).toBeCloseTo(0.7);
    expect(r.ciGreenRate).toBeCloseTo(0.6);
    expect(r.degradedRate).toBeCloseTo(0.2);
    // A run that did not go CI-green shipped a defect: 10 - 6 = 4.
    expect(r.defects).toBe(4);
    expect(r.avgScore).toBeCloseTo(0.7);
  });

  it('drops rows with a null key (unattributed producers)', () => {
    expect(summarizeProducers([row({ key: null })])).toEqual([]);
  });

  it('orders worst producers first (most defects, then lowest score)', () => {
    const out = summarizeProducers([
      row({ key: 'good', runs: 10, ciGreen: 10, avgScore: 0.9 }),   // 0 defects
      row({ key: 'bad',  runs: 10, ciGreen: 2,  avgScore: 0.3 }),   // 8 defects
      row({ key: 'mid',  runs: 10, ciGreen: 7,  avgScore: 0.6 }),   // 3 defects
    ]);
    expect(out.map((r) => r.key)).toEqual(['bad', 'mid', 'good']);
  });

  it('breaks a defect tie by lower average score', () => {
    const out = summarizeProducers([
      row({ key: 'cheap', runs: 5, ciGreen: 3, avgScore: 0.8 }),   // 2 defects
      row({ key: 'risky', runs: 5, ciGreen: 3, avgScore: 0.4 }),   // 2 defects, worse score
    ]);
    expect(out.map((r) => r.key)).toEqual(['risky', 'cheap']);
  });

  it('guards divide-by-zero on a producer with no runs', () => {
    const r = summarizeProducers([row({ runs: 0, merged: 0, ciGreen: 0, degraded: 0 })])[0]!;
    expect(r.mergedRate).toBe(0);
    expect(r.ciGreenRate).toBe(0);
    expect(r.defects).toBe(0);
    expect(r.escapedDefects).toBe(0);
  });

  it('folds escaped-defect attribution in by key', () => {
    const r = summarizeProducers([row({ key: 'opus', runs: 10, ciGreen: 9 })], { opus: 4, other: 99 })[0]!;
    expect(r.escapedDefects).toBe(4);
  });

  it('orders by combined caught + escaped defects', () => {
    // 'clean' has 0 caught but 5 escaped; 'flaky' has 3 caught + 0 escaped → clean is worse.
    const out = summarizeProducers(
      [row({ key: 'clean', runs: 10, ciGreen: 10, avgScore: 0.9 }), row({ key: 'flaky', runs: 10, ciGreen: 7, avgScore: 0.6 })],
      { clean: 5 },
    );
    expect(out.map((r) => r.key)).toEqual(['clean', 'flaky']);
  });
});

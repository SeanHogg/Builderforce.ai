import { describe, expect, it } from 'vitest';
import { FRONTIER_PARITY_BAR, frontierParity, meetsParity, parityRatio, readComparablePair, readEvalSummary } from './admission';
import { EVERMIND_CODING_QUALITY_BAR } from '../evermindCodingGate';

const summary = (meanScore: number, over: Partial<{ dataset: string; cases: number }> = {}) =>
  ({ dataset: 'specialist:x', meanScore, cases: 20, ...over });

describe('FRONTIER_PARITY_BAR', () => {
  it('is the operator decision, and the Evermind coding gate reads the same bar', () => {
    expect(FRONTIER_PARITY_BAR).toBe(0.9);
    expect(EVERMIND_CODING_QUALITY_BAR).toBe(FRONTIER_PARITY_BAR);
  });
});

describe('frontierParity', () => {
  it('admits at exactly 90% of the frontier on the same eval', () => {
    const v = frontierParity(summary(0.72), summary(0.8));
    expect(v.admitted).toBe(true);
    expect(v.ratio).toBeCloseTo(0.9);
    expect(v.problem).toBeNull();
  });

  it('refuses just under the bar', () => {
    expect(frontierParity(summary(0.719), summary(0.8)).admitted).toBe(false);
  });

  it('refuses to compare different evals or a different case count', () => {
    expect(frontierParity(summary(1), summary(1, { dataset: 'other' }))).toMatchObject({ admitted: false, ratio: null });
    expect(frontierParity(summary(1), summary(1, { cases: 19 })).problem).toMatch(/case counts/);
  });

  it('refuses a frontier that scored zero', () => {
    expect(frontierParity(summary(0.5), summary(0)).problem).toMatch(/above 0/);
  });

  it('honours a per-job bar', () => {
    expect(frontierParity(summary(0.9), summary(1), 0.95).admitted).toBe(false);
  });
});

describe('parityRatio / meetsParity', () => {
  it('is null for an undividable frontier and never meets the bar', () => {
    expect(parityRatio(0.5, 0)).toBeNull();
    expect(meetsParity(null)).toBe(false);
    expect(meetsParity(0.9)).toBe(true);
  });
});

describe('readEvalSummary / readComparablePair', () => {
  it('reads a report whose cases are an array or a count', () => {
    expect(readEvalSummary({ dataset: 'd', meanScore: 0.5, cases: [1, 2] }, 'x')).toEqual({ ok: true, summary: { dataset: 'd', meanScore: 0.5, cases: 2 } });
    expect(readEvalSummary({ dataset: 'd', meanScore: 0.5, cases: 3 }, 'x')).toMatchObject({ ok: true });
  });

  it('names the report in each error', () => {
    expect(readEvalSummary(null, 'evermind')).toEqual({ ok: false, error: 'evermind report is required' });
    expect(readEvalSummary({ dataset: 'd', meanScore: 2, cases: 1 }, 'baseline')).toMatchObject({ ok: false, error: 'baseline meanScore must be in [0, 1]' });
    expect(readEvalSummary({ dataset: 'd', meanScore: 0.5, cases: 0 }, 'x')).toMatchObject({ ok: false });
  });

  it('pairs only the same eval with a frontier above zero', () => {
    const ok = readComparablePair({ dataset: 'd', meanScore: 0.5, cases: 2 }, { dataset: 'd', meanScore: 0.6, cases: 2 }, { candidate: 'c', frontier: 'f' });
    expect(ok).toMatchObject({ ok: true, candidate: { meanScore: 0.5 }, frontier: { meanScore: 0.6 } });
    expect(readComparablePair({ dataset: 'd', meanScore: 0.5, cases: 2 }, { dataset: 'd', meanScore: 0, cases: 2 }, { candidate: 'c', frontier: 'baseline' }))
      .toEqual({ ok: false, error: 'baseline meanScore must be above 0 to compare against' });
  });
});

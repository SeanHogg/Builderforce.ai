import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_PASS_FLOOR,
  expectationCoverage,
  parseExpectations,
  scoreAnswer,
  summarizeTrend,
  type BenchmarkCase,
  type BenchmarkTrendPoint,
} from './agentBenchmark';

const benchmarkCase: BenchmarkCase = {
  id: 'c1',
  slug: 'add-a-column',
  name: 'Add a column',
  prompt: 'How do you add a column to a table in this codebase?',
  expectations: ['migration', 'schema module'],
  category: 'general',
  projectId: null,
  enabled: true,
};

/**
 * GAP B3 — a fixed task set is only worth having if its scoring is stable. These
 * pin the two halves that decide a pass, and the arithmetic behind a regression.
 */
describe('expectationCoverage', () => {
  it('is the fraction of expectations present, case-insensitively', () => {
    expect(expectationCoverage('Write a MIGRATION then update the schema module.', benchmarkCase.expectations)).toBe(1);
    expect(expectationCoverage('Write a migration.', benchmarkCase.expectations)).toBe(0.5);
    expect(expectationCoverage('No idea.', benchmarkCase.expectations)).toBe(0);
  });

  it('is 1 for a case that asserts nothing — the evaluator alone judges it', () => {
    expect(expectationCoverage('anything', [])).toBe(1);
  });
});

describe('parseExpectations', () => {
  it('reads the stored JSON array and tolerates a malformed row', () => {
    expect(parseExpectations('["a","b"]')).toEqual(['a', 'b']);
    expect(parseExpectations('not json')).toEqual([]);
    expect(parseExpectations(null)).toEqual([]);
    expect(parseExpectations('{"a":1}')).toEqual([]);
  });
});

describe('scoreAnswer', () => {
  it('requires BOTH coverage and score to clear the floor before it passes', async () => {
    // A judge that always returns nothing parseable ⇒ the deterministic lexical path.
    const covered = await scoreAnswer(benchmarkCase, 'Write a migration and update the schema module for this codebase table column.');
    expect(covered.coverage).toBe(1);
    expect(covered.passed).toBe(covered.score >= BENCHMARK_PASS_FLOOR);

    const uncovered = await scoreAnswer(benchmarkCase, 'Ask someone else.');
    expect(uncovered.coverage).toBe(0);
    expect(uncovered.passed).toBe(false);
  });
});

describe('summarizeTrend', () => {
  const point = (score: number, passed: boolean, coverage = 1): BenchmarkTrendPoint => ({
    caseId: 'c1', score, coverage, passed, model: 'm', cloudAgentRef: 'a', at: new Date().toISOString(),
  });

  it('is all zeroes for an empty series rather than NaN', () => {
    expect(summarizeTrend([])).toEqual({ attempts: 0, passRate: 0, meanScore: 0, meanCoverage: 0, regression: 0 });
  });

  it('reports a positive regression when the newer half scores worse', () => {
    const summary = summarizeTrend([point(0.9, true), point(0.9, true), point(0.5, false), point(0.5, false)]);
    expect(summary.attempts).toBe(4);
    expect(summary.passRate).toBe(0.5);
    expect(summary.regression).toBeCloseTo(0.4);
  });

  it('reports a negative regression when quality improved', () => {
    expect(summarizeTrend([point(0.4, false), point(0.8, true)]).regression).toBeCloseTo(-0.4);
  });

  it('compares halves rather than the last two points, so one bad run is not a trend', () => {
    const steady = [point(0.9, true), point(0.9, true), point(0.9, true), point(0.85, true)];
    expect(summarizeTrend(steady).regression).toBeLessThan(0.1);
  });
});

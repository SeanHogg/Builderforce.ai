import { describe, expect, it } from 'vitest';
import { RUN_TOKEN_CAP_BY_PLAN, checkRunLimits, resolveRunTokenCap, runBudgetUsedShare } from './runLimits';

describe('checkRunLimits', () => {
  const limits = { maxFiles: 2, maxRepositories: 1, maxSpendMillicents: 100 };
  it('allows usage inside every declared boundary', () => expect(checkRunLimits(limits, { files: 2, repositories: 1, spendMillicents: 99 })).toBeNull());
  it('blocks a new file beyond the boundary', () => expect(checkRunLimits(limits, { files: 3, repositories: 1, spendMillicents: 0 })).toContain('file limit'));
  it('fails closed at the spend boundary', () => expect(checkRunLimits(limits, { files: 0, repositories: 1, spendMillicents: 100 })).toContain('spend limit'));
});

describe('per-run token cap (A2)', () => {
  const capped = { maxFiles: null, maxRepositories: null, maxSpendMillicents: null, maxTokens: 1_000 };
  it('trips at the cap and ignores tokens when no cap is set', () => {
    expect(checkRunLimits(capped, { files: 0, repositories: 0, spendMillicents: 0, tokens: 999 })).toBeNull();
    expect(checkRunLimits(capped, { files: 0, repositories: 0, spendMillicents: 0, tokens: 1_000 })).toBe('token limit reached (1000/1000 tokens)');
    expect(checkRunLimits({ ...capped, maxTokens: null }, { files: 0, repositories: 0, spendMillicents: 0, tokens: 9e9 })).toBeNull();
  });
  it('defaults by plan and honours a payload override', () => {
    expect(resolveRunTokenCap('free')).toBe(RUN_TOKEN_CAP_BY_PLAN.free);
    expect(resolveRunTokenCap('pro')).toBe(2_000_000);
    expect(resolveRunTokenCap('teams')).toBe(5_000_000);
    expect(resolveRunTokenCap('unknown')).toBe(200_000);
    expect(resolveRunTokenCap('free', 50_000)).toBe(50_000);
    expect(resolveRunTokenCap('free', -1)).toBe(200_000);
    expect(resolveRunTokenCap('free', '9')).toBe(200_000);
  });
  it('reports the larger of the spend and token shares', () => {
    expect(runBudgetUsedShare({ ...capped, maxSpendMillicents: 100 }, { files: 0, repositories: 0, spendMillicents: 90, tokens: 100 })).toBeCloseTo(0.9);
  });
});

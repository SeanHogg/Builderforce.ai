import { describe, expect, it } from 'vitest';
import { RUN_BUDGET_WARN_AT, runBudgetBreach, runBudgetUsedShare, runBudgetWarnDue } from './index.js';

describe('runBudgetBreach', () => {
  it('is null inside every cap and when no cap is set', () => {
    expect(runBudgetBreach({ maxSpendMillicents: 100, maxTokens: 1_000 }, { spendMillicents: 99, tokens: 999 })).toBeNull();
    expect(runBudgetBreach({}, { spendMillicents: 9e9, tokens: 9e9 })).toBeNull();
    expect(runBudgetBreach({ maxSpendMillicents: null, maxTokens: null }, { spendMillicents: 9e9 })).toBeNull();
  });

  it('fails closed AT the cap, spend before tokens', () => {
    expect(runBudgetBreach({ maxSpendMillicents: 100, maxTokens: 10 }, { spendMillicents: 100, tokens: 10 }))
      .toEqual({ kind: 'spend', used: 100, cap: 100 });
    expect(runBudgetBreach({ maxTokens: 10 }, { spendMillicents: 0, tokens: 10 })).toEqual({ kind: 'tokens', used: 10, cap: 10 });
  });

  it('a cap of 0 is a cap', () => {
    expect(runBudgetBreach({ maxSpendMillicents: 0 }, { spendMillicents: 0 })).toEqual({ kind: 'spend', used: 0, cap: 0 });
  });
});

describe('runBudgetUsedShare / runBudgetWarnDue', () => {
  it('is the larger share, and warns from 80%', () => {
    expect(runBudgetUsedShare({ maxSpendMillicents: 100, maxTokens: 100 }, { spendMillicents: 90, tokens: 10 })).toBeCloseTo(0.9);
    expect(RUN_BUDGET_WARN_AT).toBe(0.8);
    expect(runBudgetWarnDue({ maxSpendMillicents: 100 }, { spendMillicents: 79 })).toBe(false);
    expect(runBudgetWarnDue({ maxSpendMillicents: 100 }, { spendMillicents: 80 })).toBe(true);
    expect(runBudgetWarnDue({}, { spendMillicents: 1e9 })).toBe(false);
  });
});

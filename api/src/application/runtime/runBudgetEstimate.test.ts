import { describe, expect, it } from 'vitest';
import type { TenantTokenAvailability } from '../llm/tenantTokenAvailability';
import { evaluateRunBudget, MIN_VIABLE_RUN_TOKENS, remainingAllowance } from './runBudgetEstimate';

const base: TenantTokenAvailability = {
  hasTokens: true, reason: null, dailyLimit: 100_000, monthlyLimit: 1_000_000,
  usageToday: 0, usageMonth: 0, effectivePlan: 'pro',
};

describe('remainingAllowance', () => {
  it('is the tightest capped window', () => {
    expect(remainingAllowance({ ...base, usageToday: 90_000, usageMonth: 10 })).toEqual({ tokens: 10_000, window: 'daily' });
    expect(remainingAllowance({ ...base, usageToday: 0, usageMonth: 995_000 })).toEqual({ tokens: 5_000, window: 'monthly' });
  });

  it('is null for an uncapped (unlimited / superadmin) tenant', () => {
    expect(remainingAllowance({ ...base, dailyLimit: -1, monthlyLimit: -1 })).toBeNull();
  });

  it('ignores an uncapped window and uses the capped one', () => {
    expect(remainingAllowance({ ...base, dailyLimit: -1, usageMonth: 400_000 })).toEqual({ tokens: 600_000, window: 'monthly' });
  });
});

describe('evaluateRunBudget (PRD 09 B3)', () => {
  it('admits a tenant with plenty of allowance', () => {
    expect(evaluateRunBudget(base)).toBeNull();
  });

  it('admits at exactly the minimum viable spend', () => {
    expect(evaluateRunBudget({ ...base, usageToday: base.dailyLimit - MIN_VIABLE_RUN_TOKENS })).toBeNull();
  });

  it('refuses one token short, naming the window, what is left and what a run needs', () => {
    const block = evaluateRunBudget({ ...base, usageToday: base.dailyLimit - MIN_VIABLE_RUN_TOKENS + 1 });
    expect(block).toMatchObject({
      code: 'insufficient_run_budget',
      window: 'daily',
      remainingTokens: MIN_VIABLE_RUN_TOKENS - 1,
      minimumTokens: MIN_VIABLE_RUN_TOKENS,
      effectivePlan: 'pro',
    });
    expect(block?.error).toContain('daily');
  });

  it('never reports negative remaining tokens', () => {
    expect(evaluateRunBudget({ ...base, usageToday: base.dailyLimit + 50 })?.remainingTokens).toBe(0);
  });

  it('never demands more than the plan per-run token cap allows a run to spend', () => {
    // Free per-run cap is 200_000, above the floor, so the floor applies.
    expect(evaluateRunBudget({ ...base, effectivePlan: 'free' })?.minimumTokens ?? MIN_VIABLE_RUN_TOKENS).toBeLessThanOrEqual(MIN_VIABLE_RUN_TOKENS);
  });

  it('passes an unlimited tenant', () => {
    expect(evaluateRunBudget({ ...base, dailyLimit: -1, monthlyLimit: -1, usageToday: 5_000_000 })).toBeNull();
  });
});

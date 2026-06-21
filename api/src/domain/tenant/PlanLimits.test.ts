import { describe, expect, it } from 'vitest';
import { getLimits, resolveImageCreditsDailyLimit, PLAN_LIMITS } from './PlanLimits';
import { TenantPlan } from '../shared/types';

describe('PlanLimits — image credits are a distinct budget from tokens', () => {
  it('every plan declares an imageCreditsDailyLimit independent of tokenDailyLimit', () => {
    for (const plan of [TenantPlan.FREE, TenantPlan.PRO, TenantPlan.TEAMS]) {
      const l = getLimits(plan);
      expect(typeof l.imageCreditsDailyLimit).toBe('number');
      expect(l.imageCreditsDailyLimit).toBeGreaterThan(0);
      // The two budgets are tracked separately — not derived from one another.
      expect(l.imageCreditsDailyLimit).not.toBe(l.tokenDailyLimit);
    }
  });

  it('paid plans get a larger image budget than free', () => {
    expect(PLAN_LIMITS[TenantPlan.PRO].imageCreditsDailyLimit)
      .toBeGreaterThan(PLAN_LIMITS[TenantPlan.FREE].imageCreditsDailyLimit);
    expect(PLAN_LIMITS[TenantPlan.TEAMS].imageCreditsDailyLimit)
      .toBeGreaterThanOrEqual(PLAN_LIMITS[TenantPlan.PRO].imageCreditsDailyLimit);
  });
});

describe('resolveImageCreditsDailyLimit', () => {
  it('null override → plan default', () => {
    expect(resolveImageCreditsDailyLimit(null, TenantPlan.FREE)).toBe(PLAN_LIMITS[TenantPlan.FREE].imageCreditsDailyLimit);
    expect(resolveImageCreditsDailyLimit(undefined, TenantPlan.PRO)).toBe(PLAN_LIMITS[TenantPlan.PRO].imageCreditsDailyLimit);
  });

  it('-1 override → unlimited (gate skipped)', () => {
    expect(resolveImageCreditsDailyLimit(-1, TenantPlan.FREE)).toBe(-1);
  });

  it('>= 0 override → that explicit value', () => {
    expect(resolveImageCreditsDailyLimit(0, TenantPlan.PRO)).toBe(0);
    expect(resolveImageCreditsDailyLimit(250, TenantPlan.FREE)).toBe(250);
  });
});

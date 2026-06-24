import { describe, expect, it } from 'vitest';
import {
  getLimits,
  resolveImageCreditsDailyLimit,
  resolveTokenLimits,
  resolveIngestionMonthlyBytes,
  PLAN_LIMITS,
} from './PlanLimits';
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

describe('PlanLimits — monthly AI-token allowance (consumption meter)', () => {
  it('every plan declares a tokenMonthlyLimit', () => {
    for (const plan of [TenantPlan.FREE, TenantPlan.PRO, TenantPlan.TEAMS]) {
      expect(typeof getLimits(plan).tokenMonthlyLimit).toBe('number');
    }
  });

  it('free tier is the headline 50K/mo meter allowance', () => {
    expect(PLAN_LIMITS[TenantPlan.FREE].tokenMonthlyLimit).toBe(50_000);
  });

  it('paid plans get more monthly tokens than free; teams is unlimited (-1)', () => {
    expect(PLAN_LIMITS[TenantPlan.PRO].tokenMonthlyLimit)
      .toBeGreaterThan(PLAN_LIMITS[TenantPlan.FREE].tokenMonthlyLimit);
    expect(PLAN_LIMITS[TenantPlan.TEAMS].tokenMonthlyLimit).toBe(-1);
  });
});

describe('resolveTokenLimits — one resolver shared by the gate and the meter', () => {
  it('free, no override → plan daily + monthly defaults', () => {
    expect(resolveTokenLimits({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: null }))
      .toEqual({ dailyLimit: 10_000, monthlyLimit: 50_000 });
  });

  it('teams, no override → monthly unlimited (-1)', () => {
    expect(resolveTokenLimits({ effectivePlan: TenantPlan.TEAMS, tokenDailyLimitOverride: null }).monthlyLimit).toBe(-1);
  });

  it('override -1 → both unlimited', () => {
    expect(resolveTokenLimits({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: -1 }))
      .toEqual({ dailyLimit: -1, monthlyLimit: -1 });
  });

  it('superadmin → both unlimited regardless of plan', () => {
    expect(resolveTokenLimits({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: null, isSuperadmin: true }))
      .toEqual({ dailyLimit: -1, monthlyLimit: -1 });
  });

  it('explicit positive daily override → that daily value, monthly uncapped (grant not undercut)', () => {
    expect(resolveTokenLimits({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: 200_000 }))
      .toEqual({ dailyLimit: 200_000, monthlyLimit: -1 });
  });
});

describe('PlanLimits — monthly data-ingestion allowance (consumption meter)', () => {
  it('every plan declares ingestionMonthlyBytes', () => {
    for (const plan of [TenantPlan.FREE, TenantPlan.PRO, TenantPlan.TEAMS]) {
      expect(typeof getLimits(plan).ingestionMonthlyBytes).toBe('number');
    }
  });

  it('free is capped, pro is higher, teams is unlimited (-1)', () => {
    expect(PLAN_LIMITS[TenantPlan.FREE].ingestionMonthlyBytes).toBeGreaterThan(0);
    expect(PLAN_LIMITS[TenantPlan.PRO].ingestionMonthlyBytes)
      .toBeGreaterThan(PLAN_LIMITS[TenantPlan.FREE].ingestionMonthlyBytes);
    expect(PLAN_LIMITS[TenantPlan.TEAMS].ingestionMonthlyBytes).toBe(-1);
  });
});

describe('resolveIngestionMonthlyBytes', () => {
  it('free, no override → plan default', () => {
    expect(resolveIngestionMonthlyBytes({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: null }))
      .toBe(PLAN_LIMITS[TenantPlan.FREE].ingestionMonthlyBytes);
  });

  it('teams → unlimited (-1)', () => {
    expect(resolveIngestionMonthlyBytes({ effectivePlan: TenantPlan.TEAMS, tokenDailyLimitOverride: null })).toBe(-1);
  });

  it('override -1 / superadmin → unlimited across meters', () => {
    expect(resolveIngestionMonthlyBytes({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: -1 })).toBe(-1);
    expect(resolveIngestionMonthlyBytes({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: null, isSuperadmin: true })).toBe(-1);
  });

  it('a positive TOKEN override does NOT lift the ingestion cap (different axis)', () => {
    expect(resolveIngestionMonthlyBytes({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: 200_000 }))
      .toBe(PLAN_LIMITS[TenantPlan.FREE].ingestionMonthlyBytes);
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

import { describe, it, expect } from 'vitest';
import { resolveMeterLimits, type MeterLimits } from './meters';
import { TenantPlan } from '../../domain/shared/types';

/**
 * The meter is what members READ (sidebar Usage, chat diagnostics), so it must
 * resolve allowances with the same authority `tenantTokenAvailability` enforces.
 * It previously did not: a tenant with an active superadmin member was shown its
 * plain free-plan caps against real usage — "559,139,119 / 50,000 · 0 left" —
 * while every turn passed the gate untouched.
 */
describe('resolveMeterLimits', () => {
  const free = { effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: null };

  /**
   * EVERY meter, asserted by shape rather than by a fixed-length array. The
   * literal `[-1, -1, ...]` this replaced failed the day a seventh meter was
   * registered — which is the opposite of what the assertion is for: adding a
   * meter that FORGETS the superadmin bypass is the regression worth catching,
   * and adding one that honours it should not need this file edited.
   */
  const allUnlimited = (limits: MeterLimits) => {
    const values = Object.values(limits);
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => v !== -1)).toEqual([]);
  };

  it('reports every meter unlimited for a superadmin-member tenant', () => {
    allUnlimited(resolveMeterLimits({ ...free, isSuperadmin: true }));
  });

  it('reports real free-plan caps when there is no superadmin', () => {
    const limits = resolveMeterLimits({ ...free, isSuperadmin: false });
    expect(limits.tokens).toBeGreaterThan(0);
    expect(limits.cloudRuns).toBeGreaterThan(0);
    expect(limits.feedbackSubmissions).toBeGreaterThan(0);
  });

  it('honours an explicit unlimited override without a superadmin', () => {
    allUnlimited(resolveMeterLimits({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: -1, isSuperadmin: false }));
  });

  it('lifts only the token axis for a positive token override', () => {
    const limits = resolveMeterLimits({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: 500_000, isSuperadmin: false });
    expect(limits.tokens).toBe(-1);         // an explicit grant is not undercut by the monthly cap
    expect(limits.ingestion).toBeGreaterThan(0);  // a different axis stays capped
    expect(limits.cloudRuns).toBeGreaterThan(0);
    expect(limits.feedbackSubmissions).toBeGreaterThan(0);
  });
});

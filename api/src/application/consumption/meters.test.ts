import { describe, it, expect } from 'vitest';
import { resolveMeterLimits } from './meters';
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

  it('reports every meter unlimited for a superadmin-member tenant', () => {
    const limits = resolveMeterLimits({ ...free, isSuperadmin: true });
    expect(Object.values(limits)).toEqual([-1, -1, -1, -1, -1]);
  });

  it('reports real free-plan caps when there is no superadmin', () => {
    const limits = resolveMeterLimits({ ...free, isSuperadmin: false });
    expect(limits.tokens).toBeGreaterThan(0);
    expect(limits.cloudRuns).toBeGreaterThan(0);
  });

  it('honours an explicit unlimited override without a superadmin', () => {
    const limits = resolveMeterLimits({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: -1, isSuperadmin: false });
    expect(Object.values(limits)).toEqual([-1, -1, -1, -1, -1]);
  });

  it('lifts only the token axis for a positive token override', () => {
    const limits = resolveMeterLimits({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: 500_000, isSuperadmin: false });
    expect(limits.tokens).toBe(-1);         // an explicit grant is not undercut by the monthly cap
    expect(limits.ingestion).toBeGreaterThan(0);  // a different axis stays capped
    expect(limits.cloudRuns).toBeGreaterThan(0);
  });
});

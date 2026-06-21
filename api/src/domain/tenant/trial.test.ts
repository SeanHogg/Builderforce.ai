import { describe, it, expect } from 'vitest';
import { Tenant } from './Tenant';
import { getLimits } from './PlanLimits';
import { resolveEffectivePlan, trialDaysRemaining, TRIAL_DURATION_DAYS } from './effectivePlan';
import { TenantPlan, TenantBillingStatus } from '../shared/types';

describe('14-day Pro trial', () => {
  it('puts a freshly-created tenant on a Pro trial with Pro limits', () => {
    const t = Tenant.create('Acme', 'user-1');

    expect(t.plan).toBe(TenantPlan.PRO);
    expect(t.billingStatus).toBe(TenantBillingStatus.TRIALING);
    expect(t.trialEndsAt).toBeInstanceOf(Date);

    // trial_ends_at ≈ now + 14 days
    const expected = Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(t.trialEndsAt!.getTime() - expected)).toBeLessThan(5_000);

    // Effective plan is Pro right now → Pro limits.
    expect(t.effectivePlan()).toBe(TenantPlan.PRO);
    const limits = getLimits(t.effectivePlan());
    expect(limits).toEqual(getLimits(TenantPlan.PRO));
    expect(limits.tokenDailyLimit).toBe(getLimits(TenantPlan.PRO).tokenDailyLimit);

    // ~14 days remaining.
    expect(trialDaysRemaining(t.billingStatus, t.trialEndsAt)).toBe(TRIAL_DURATION_DAYS);
  });

  it('falls back to Free limits once the trial has expired', () => {
    const t = Tenant.create('Acme', 'user-1');
    // Evaluate the entitlement 15 days in the future — trial has lapsed.
    const after = new Date(Date.now() + (TRIAL_DURATION_DAYS + 1) * 24 * 60 * 60 * 1000);

    expect(t.effectivePlan(after)).toBe(TenantPlan.FREE);
    expect(getLimits(t.effectivePlan(after))).toEqual(getLimits(TenantPlan.FREE));
    expect(trialDaysRemaining(t.billingStatus, t.trialEndsAt, after)).toBeNull();
  });

  it('resolveEffectivePlan honours an active trial and ignores an expired one', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

    expect(
      resolveEffectivePlan({ plan: TenantPlan.PRO, billingStatus: TenantBillingStatus.TRIALING, trialEndsAt: future }),
    ).toBe(TenantPlan.PRO);

    expect(
      resolveEffectivePlan({ plan: TenantPlan.PRO, billingStatus: TenantBillingStatus.TRIALING, trialEndsAt: past }),
    ).toBe(TenantPlan.FREE);
  });

  it('keeps the paid active path working and clears the trial on paid conversion', () => {
    const active = resolveEffectivePlan({
      plan: TenantPlan.PRO,
      billingStatus: TenantBillingStatus.ACTIVE,
      trialEndsAt: null,
    });
    expect(active).toBe(TenantPlan.PRO);

    const converted = Tenant.create('Acme', 'user-1').activateProSubscription({
      billingCycle: 'monthly' as never,
      billingEmail: 'owner@acme.test',
      billingPaymentBrand: 'visa',
      billingPaymentLast4: '4242',
    });
    expect(converted.billingStatus).toBe(TenantBillingStatus.ACTIVE);
    expect(converted.trialEndsAt).toBeNull();
    expect(converted.effectivePlan()).toBe(TenantPlan.PRO);
  });

  it('a non-trialing free tenant gets Free limits', () => {
    expect(
      resolveEffectivePlan({ plan: TenantPlan.FREE, billingStatus: TenantBillingStatus.NONE, trialEndsAt: null }),
    ).toBe(TenantPlan.FREE);
  });
});

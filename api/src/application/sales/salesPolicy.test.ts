import { describe, expect, it } from 'vitest';
import { commissionCents, commissionPercentToBps, salesDealRevenueCents, salesRevenueForecast } from './salesPolicy';

describe('sales commission policy', () => {
  it('uses authoritative plan pricing and the Teams minimum seat commitment', () => {
    expect(salesDealRevenueCents('pro', 'monthly')).toBe(2_900);
    expect(salesDealRevenueCents('pro', 'yearly')).toBe(29_000);
    expect(salesDealRevenueCents('teams', 'monthly', 1)).toBe(10_000);
    expect(salesDealRevenueCents('teams', 'yearly', 8)).toBe(153_600);
  });

  it('rejects malformed or out-of-range percentages', () => {
    expect(commissionPercentToBps(undefined)).toBeNull();
    expect(commissionPercentToBps(Number.NaN)).toBeNull();
    expect(commissionPercentToBps(-0.01)).toBeNull();
    expect(commissionPercentToBps(100.01)).toBeNull();
    expect(commissionPercentToBps(12.25)).toBe(1_225);
  });

  it('calculates rounded commissions and conversion goals', () => {
    expect(commissionCents(2_900, 1_225)).toBe(355);
    expect(salesRevenueForecast(10_000, [{ ruleKey: 'pro:monthly', plan: 'pro', billingCycle: 'monthly', referralBps: 1_000, salesBps: 2_000 }])[0]).toMatchObject({ conversionsRequired: 4, referralCommissionPerConversionCents: 290, salesCommissionPerConversionCents: 580 });
  });
});

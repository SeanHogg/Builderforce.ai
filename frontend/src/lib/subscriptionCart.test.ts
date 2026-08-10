import { describe, expect, it } from 'vitest';
import { calculateSubscriptionLine, subscriptionCheckoutPayload } from './subscriptionCart';

describe('subscription cart', () => {
  it('calculates monthly and annual Teams totals from the selected seat scale', () => {
    const plan = { monthly: 20, yearly: 192 };
    expect(calculateSubscriptionLine(plan, 'teams', 'monthly', 5)).toEqual({ unitPrice: 20, total: 100 });
    expect(calculateSubscriptionLine(plan, 'teams', 'yearly', 8)).toEqual({ unitPrice: 192, total: 1536 });
  });

  it('does not multiply a Pro subscription by the Teams seat selection', () => {
    expect(calculateSubscriptionLine({ monthly: 29, yearly: 290 }, 'pro', 'yearly', 12))
      .toEqual({ unitPrice: 290, total: 290 });
  });

  it('preserves the interval, seats, and retained discount in the checkout payload', () => {
    expect(subscriptionCheckoutPayload({
      targetPlan: 'teams', billingCycle: 'yearly', seats: 7, discountCode: 'ANNUAL50',
    }, 'buyer@example.com')).toEqual({
      targetPlan: 'teams', billingCycle: 'yearly', seats: 7,
      discountCode: 'ANNUAL50', billingEmail: 'buyer@example.com',
    });
  });
});

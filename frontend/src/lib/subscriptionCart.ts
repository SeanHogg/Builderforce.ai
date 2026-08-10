import type { CartItem } from './CartContext';

export type SubscriptionTargetPlan = 'pro' | 'teams';
export type SubscriptionBillingCycle = 'monthly' | 'yearly';

export function calculateSubscriptionLine(
  plan: { monthly: number; yearly: number },
  targetPlan: 'free' | SubscriptionTargetPlan,
  billingCycle: SubscriptionBillingCycle,
  seats: number,
): { unitPrice: number; total: number } {
  const unitPrice = billingCycle === 'yearly' ? plan.yearly : plan.monthly;
  return { unitPrice, total: unitPrice * (targetPlan === 'teams' ? seats : 1) };
}

export function subscriptionCheckoutPayload(
  item: Pick<CartItem, 'targetPlan' | 'billingCycle' | 'seats' | 'discountCode'>,
  billingEmail: string,
) {
  if (!item.targetPlan || !item.billingCycle) throw new Error('Invalid subscription cart item');
  return {
    targetPlan: item.targetPlan,
    billingCycle: item.billingCycle,
    billingEmail,
    ...(item.targetPlan === 'teams' && { seats: item.seats }),
    ...(item.discountCode && { discountCode: item.discountCode }),
  };
}

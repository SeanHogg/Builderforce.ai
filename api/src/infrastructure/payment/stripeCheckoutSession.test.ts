import { describe, expect, it } from 'vitest';
import { checkoutSessionParams } from './stripeCheckoutSession';

describe('checkoutSessionParams — one descriptor, one encoding', () => {
  it('mirrors metadata onto the payment intent for a pay-once session', () => {
    const body = checkoutSessionParams({
      mode: 'payment',
      successUrl: 'https://x.test/ok',
      cancelUrl: 'https://x.test/no',
      customerEmail: 'b@x.test',
      lineItems: [{ quantity: 2, currency: 'USD', unitAmountCents: 1500, name: 'Pack' }],
      metadata: { purchaseKind: 'knowledge_listing', listingId: 'l1' },
    });
    expect(body.get('mode')).toBe('payment');
    expect(body.get('customer_email')).toBe('b@x.test');
    expect(body.get('line_items[0][quantity]')).toBe('2');
    expect(body.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1500');
    expect(body.get('line_items[0][price_data][recurring][interval]')).toBeNull();
    expect(body.get('metadata[purchaseKind]')).toBe('knowledge_listing');
    expect(body.get('payment_intent_data[metadata][listingId]')).toBe('l1');
    expect(body.get('subscription_data[metadata][listingId]')).toBeNull();
  });

  it('mirrors metadata onto the subscription for a recurring session, line by line', () => {
    const body = checkoutSessionParams({
      mode: 'subscription',
      successUrl: 'https://x.test/ok',
      cancelUrl: 'https://x.test/no',
      lineItems: [
        { quantity: 1, currency: 'usd', unitAmountCents: 1995, name: 'Activation' },
        { quantity: 1, currency: 'usd', unitAmountCents: 995, interval: 'month', name: 'Service' },
      ],
      metadata: { purchaseKind: 'business_phone' },
    });
    expect(body.has('customer_email')).toBe(false);
    expect(body.get('line_items[0][price_data][recurring][interval]')).toBeNull();
    expect(body.get('line_items[1][price_data][recurring][interval]')).toBe('month');
    expect(body.get('subscription_data[metadata][purchaseKind]')).toBe('business_phone');
    expect(body.get('payment_intent_data[metadata][purchaseKind]')).toBeNull();
  });

  it('uses a reusable Price instead of inline price data when one is named', () => {
    const body = checkoutSessionParams({
      mode: 'subscription',
      successUrl: 'a',
      cancelUrl: 'b',
      lineItems: [{ quantity: 5, priceId: 'price_teams' }],
      metadata: {},
      extraParams: { 'discounts[0][coupon]': 'co_1' },
    });
    expect(body.get('line_items[0][price]')).toBe('price_teams');
    expect(body.has('line_items[0][price_data][currency]')).toBe(false);
    expect(body.get('discounts[0][coupon]')).toBe('co_1');
  });

  it('truncates a product name to what the processor accepts', () => {
    const body = checkoutSessionParams({
      mode: 'payment',
      successUrl: 'a',
      cancelUrl: 'b',
      lineItems: [{ quantity: 1, currency: 'usd', unitAmountCents: 1, name: 'x'.repeat(400) }],
      metadata: {},
    });
    expect(body.get('line_items[0][price_data][product_data][name]')).toHaveLength(250);
  });
});

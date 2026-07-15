import { afterEach, describe, expect, it, vi } from 'vitest';
import { StripeProvider } from './StripeProvider';

const WEBHOOK_SECRET = 'whsec_test_secret';

function makeProvider(): StripeProvider {
  return new StripeProvider({
    secretKey: 'sk_test_key',
    webhookSecret: WEBHOOK_SECRET,
    priceProMonthly: 'price_pro_monthly',
    priceProYearly: 'price_pro_yearly',
    priceTeamsMonthly: 'price_teams_monthly',
    priceTeamsYearly: 'price_teams_yearly',
  });
}

/** Build a genuine `t=<ts>,v1=<hmac>` header the way Stripe signs webhooks. */
async function sign(
  body: string,
  { secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000), extraV1 }: { secret?: string; ts?: number; extraV1?: string } = {},
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${body}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return extraV1 ? `t=${ts},v1=${extraV1},v1=${hex}` : `t=${ts},v1=${hex}`;
}

function subscriptionUpdated(status: string): string {
  return JSON.stringify({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_123', customer: 'cus_123', status, metadata: {} } },
  });
}

/** Stub `fetch` so the provider's card lookup resolves without a network call. */
function stubCardFetch(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyStripeSignature (via parseWebhook)', () => {
  it('accepts a correctly signed payload', async () => {
    const body = subscriptionUpdated('active');
    const event = await makeProvider().parseWebhook(body, await sign(body));
    expect(event?.type).toBe('subscription.renewed');
  });

  it('rejects a payload signed with the wrong secret', async () => {
    const body = subscriptionUpdated('active');
    const header = await sign(body, { secret: 'whsec_wrong' });
    await expect(makeProvider().parseWebhook(body, header)).rejects.toThrow(/signature/i);
  });

  it('rejects a tampered payload', async () => {
    const header = await sign(subscriptionUpdated('active'));
    await expect(makeProvider().parseWebhook(subscriptionUpdated('canceled'), header)).rejects.toThrow(/signature/i);
  });

  it('rejects a replayed payload outside the tolerance window', async () => {
    const body = subscriptionUpdated('active');
    // Correctly signed, but captured over an hour ago.
    const header = await sign(body, { ts: Math.floor(Date.now() / 1000) - 3600 });
    await expect(makeProvider().parseWebhook(body, header)).rejects.toThrow(/signature/i);
  });

  it('accepts when any v1 signature matches, as during secret rotation', async () => {
    const body = subscriptionUpdated('active');
    const header = await sign(body, { extraV1: 'deadbeef' });
    const event = await makeProvider().parseWebhook(body, header);
    expect(event?.type).toBe('subscription.renewed');
  });

  it('rejects a header with no signature', async () => {
    const body = subscriptionUpdated('active');
    await expect(makeProvider().parseWebhook(body, 't=123')).rejects.toThrow(/signature/i);
  });
});

describe('customer.subscription.updated status mapping', () => {
  it.each([
    ['active', 'subscription.renewed'],
    ['trialing', 'subscription.renewed'],
    ['past_due', 'subscription.past_due'],
    ['unpaid', 'subscription.past_due'],
    ['canceled', 'subscription.cancelled'],
  ])('maps %s to %s', async (status, expected) => {
    const body = subscriptionUpdated(status);
    const event = await makeProvider().parseWebhook(body, await sign(body));
    expect(event?.type).toBe(expected);
  });

  // Regression: these once fell through to `subscription.renewed`, which activates a
  // paid plan — so an unpaid or cancelled customer would have kept Pro for free.
  it.each(['incomplete', 'incomplete_expired', 'paused'])(
    'ignores %s rather than treating it as a renewal',
    async (status) => {
      const body = subscriptionUpdated(status);
      expect(await makeProvider().parseWebhook(body, await sign(body))).toBeNull();
    },
  );

  it('never reports a renewal for a cancelled subscription', async () => {
    const body = subscriptionUpdated('canceled');
    const event = await makeProvider().parseWebhook(body, await sign(body));
    expect(event?.type).not.toBe('subscription.renewed');
  });
});

describe('checkout.session.completed', () => {
  const session = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_123',
        mode: 'subscription',
        customer: 'cus_123',
        subscription: 'sub_123',
        customer_email: 'billing@example.com',
        metadata: { tenantId: '7', billingCycle: 'yearly', targetPlan: 'teams', seats: '5' },
      },
    },
  });

  it('reads card details off the subscription, which the session payload lacks', async () => {
    stubCardFetch({ default_payment_method: { card: { brand: 'visa', last4: '4242' } } });
    const event = await makeProvider().parseWebhook(session, await sign(session));

    expect(event?.paymentBrand).toBe('visa');
    expect(event?.paymentLast4).toBe('4242');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/subscriptions/sub_123'),
      expect.anything(),
    );
  });

  it('falls back to the latest invoice payment method', async () => {
    stubCardFetch({
      default_payment_method: null,
      latest_invoice: { payment_intent: { payment_method: { card: { brand: 'amex', last4: '0005' } } } },
    });
    const event = await makeProvider().parseWebhook(session, await sign(session));
    expect(event?.paymentBrand).toBe('amex');
    expect(event?.paymentLast4).toBe('0005');
  });

  it('still activates when the card lookup fails', async () => {
    stubCardFetch({}, false);
    const event = await makeProvider().parseWebhook(session, await sign(session));

    expect(event?.type).toBe('subscription.activated');
    expect(event?.seats).toBe(5);
    // Omitted rather than blank, so the tenant's existing card is left untouched.
    expect(event?.paymentBrand).toBeUndefined();
  });

  it('carries plan, cycle, seats and email through to activation', async () => {
    stubCardFetch({ default_payment_method: { card: { brand: 'visa', last4: '4242' } } });
    const event = await makeProvider().parseWebhook(session, await sign(session));

    expect(event).toMatchObject({
      type: 'subscription.activated',
      externalCustomerId: 'cus_123',
      externalSubscriptionId: 'sub_123',
      billingCycle: 'yearly',
      targetPlan: 'teams',
      seats: 5,
      billingEmail: 'billing@example.com',
    });
  });
});

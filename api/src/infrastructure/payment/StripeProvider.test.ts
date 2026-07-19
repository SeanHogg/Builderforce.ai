import { afterEach, describe, expect, it, vi } from 'vitest';
import { StripeProvider } from './StripeProvider';
import { buildPaymentProvider, PaymentNotConfiguredError } from './index';
import type { Env } from '../../env';

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

describe('buildPaymentProvider — unconfigured', () => {
  // Regression: this factory runs at Worker boot for every request. It used to throw
  // when secrets were missing, which would 500 the entire API rather than just billing.
  it('builds without throwing when no Stripe secrets are set', () => {
    expect(() => buildPaymentProvider({} as Env)).not.toThrow();
  });

  // Regression: the deleted ManualProvider activated a paid plan with no charge, so an
  // unconfigured deploy gave Teams away to anyone who typed a card brand into a form.
  // Unconfigured must now FAIL, never silently succeed.
  it('refuses to create a checkout session instead of activating for free', async () => {
    const provider = buildPaymentProvider({} as Env);
    await expect(provider.createCheckoutSession({
      tenantId: 1,
      billingCycle: 'monthly' as never,
      billingEmail: 'a@example.com',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/no',
    })).rejects.toBeInstanceOf(PaymentNotConfiguredError);
  });

  it('refuses to start a card validation session', async () => {
    const provider = buildPaymentProvider({} as Env);
    await expect(provider.createCardValidationSession({
      tenantId: 1,
      billingEmail: 'a@example.com',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/no',
    })).rejects.toBeInstanceOf(PaymentNotConfiguredError);
  });

  it('refuses to parse a webhook without a signing secret', async () => {
    const provider = buildPaymentProvider({ STRIPE_SECRET_KEY: 'sk_test' } as Env);
    await expect(provider.parseWebhook('{}', 't=1,v1=abc')).rejects.toBeInstanceOf(PaymentNotConfiguredError);
  });
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

/**
 * Card removal. We store only brand + last4 of a validated card, never the
 * payment-method id, so revoking means "detach whatever this CUSTOMER has" —
 * list, then detach each. The states that matter are the ones where a naive
 * implementation would throw at the user instead of completing their request.
 */
describe('detachCards', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stub fetch with an ordered script of [status, body] responses. */
  function stubSequence(steps: Array<[number, unknown]>): { calls: Array<{ url: string; method?: string }> } {
    const calls: Array<{ url: string; method?: string }> = [];
    let i = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      const [status, body] = steps[Math.min(i++, steps.length - 1)]!;
      return new Response(JSON.stringify(body), { status });
    }));
    return { calls };
  }

  it('detaches every card the customer has and reports the count', async () => {
    const { calls } = stubSequence([
      [200, { data: [{ id: 'pm_1' }, { id: 'pm_2' }] }],
      [200, {}],
      [200, {}],
    ]);

    await expect(makeProvider().detachCards({ externalCustomerId: 'cus_123' })).resolves.toBe(2);
    expect(calls[0]!.url).toContain('/v1/payment_methods?customer=cus_123');
    expect(calls[1]).toMatchObject({ url: expect.stringContaining('/pm_1/detach'), method: 'POST' });
    expect(calls[2]).toMatchObject({ url: expect.stringContaining('/pm_2/detach'), method: 'POST' });
  });

  it('is a no-op for a customer with nothing stored', async () => {
    stubSequence([[200, { data: [] }]]);
    await expect(makeProvider().detachCards({ externalCustomerId: 'cus_empty' })).resolves.toBe(0);
  });

  it('treats an unknown customer as already-clean rather than an error', async () => {
    // The caller's goal is "the processor no longer holds their card". A 404
    // customer already satisfies that, so failing here would block a removal
    // that has nothing left to do.
    stubSequence([[404, { error: { message: 'No such customer' } }]]);
    await expect(makeProvider().detachCards({ externalCustomerId: 'cus_gone' })).resolves.toBe(0);
  });

  it('tolerates an already-detached card (Stripe 400s on a re-detach)', async () => {
    stubSequence([
      [200, { data: [{ id: 'pm_1' }] }],
      [400, { error: { message: 'already detached' } }],
    ]);
    // Desired end state reached, so no throw — but it wasn't detached by US.
    await expect(makeProvider().detachCards({ externalCustomerId: 'cus_123' })).resolves.toBe(0);
  });

  it('skips the network entirely when there is no customer id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(makeProvider().detachCards({ externalCustomerId: '' })).resolves.toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('detaches ONLY the named card when the payment-method id is known', async () => {
    // The post-0346 path. Detaching by id is what makes a REPLACE safe (revoke the
    // displaced card, not the one just validated) and what a multi-card tenant needs.
    const { calls } = stubSequence([[200, {}]]);

    await expect(makeProvider().detachCards({ paymentMethodId: 'pm_old', externalCustomerId: 'cus_123' }))
      .resolves.toBe(1);

    // One call, straight to the detach — the customer sweep must not run.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: expect.stringContaining('/pm_old/detach'), method: 'POST' });
    expect(calls[0]!.url).not.toContain('payment_methods?customer');
  });

  it('treats a card the processor no longer knows as already removed', async () => {
    stubSequence([[404, { error: { message: 'No such PaymentMethod' } }]]);
    await expect(makeProvider().detachCards({ paymentMethodId: 'pm_gone' })).resolves.toBe(0);
  });

  it('surfaces a real provider failure instead of silently reporting success', async () => {
    stubSequence([[500, { error: { message: 'Stripe is down' } }]]);
    await expect(makeProvider().detachCards({ externalCustomerId: 'cus_123' })).rejects.toThrow(/Stripe is down/);
  });
});

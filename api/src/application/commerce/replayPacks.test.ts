/**
 * Recording-pack checkout (the first of the three moves; settlement is in
 * `replayPackSettlement.test.ts`). Mocked Stripe provider, a fake db whose catalog
 * read finds no listing (so the D4 ladder applies), and the trace module spied.
 */
import { vi, describe, expect, it, beforeEach } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  createOneTimeCheckoutSession: vi.fn(),
  recordReplayTrace: vi.fn(async () => undefined),
}));

vi.mock('../../infrastructure/payment', () => {
  class PaymentNotConfiguredError extends Error {
    readonly code = 'payment_not_configured' as const;
    constructor(public missing: string) {
      super(`Payments are not configured: ${missing} is not set on this Worker.`);
      this.name = 'PaymentNotConfiguredError';
    }
  }
  return {
    PaymentNotConfiguredError,
    buildPaymentProvider: vi.fn((env: { STRIPE_SECRET_KEY?: string }) => {
      if (!env.STRIPE_SECRET_KEY) {
        return {
          createOneTimeCheckoutSession: () =>
            Promise.reject(new PaymentNotConfiguredError('STRIPE_SECRET_KEY')),
        };
      }
      return { createOneTimeCheckoutSession: mocks.createOneTimeCheckoutSession };
    }),
  };
});

vi.mock('../replay/replayTrace', () => ({
  recordReplayTrace: mocks.recordReplayTrace,
  REPLAY_TRACE_VERBS: {
    checkoutStarted: 'replay.checkout.started',
    checkoutSessionCreated: 'replay.checkout.session_created',
  },
}));

import { ReplayCommerceError, REPLAY_PACK_KIND, startReplayPackCheckout } from './replayPacks';

/** Catalog read → no listing; nothing else is touched by checkout. */
const fakeDb = {
  select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
} as unknown as Db;

const stripeEnv = { STRIPE_SECRET_KEY: 'sk_test_123', APP_URL: 'https://app.example.com,https://www.example.com' } as unknown as Env;

beforeEach(() => {
  mocks.createOneTimeCheckoutSession.mockReset();
  mocks.createOneTimeCheckoutSession.mockResolvedValue({
    checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
    sessionId: 'cs_test_123',
  });
  mocks.recordReplayTrace.mockClear();
});

describe('startReplayPackCheckout', () => {
  it('opens a hosted checkout for the published pack with signed metadata', async () => {
    const result = await startReplayPackCheckout(fakeDb, stripeEnv, {
      tenantId: 7,
      buyerRef: 'u1',
      actorId: 'u1',
      packId: 'p10k',
      billingEmail: 'buyer@example.com',
      returnUrl: 'https://app.example.com/apps/insights?tab=plan',
    });

    expect(result).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
      sessionId: 'cs_test_123',
      pack: { id: 'p10k', units: 10_000, amountCents: 4_000 },
    });
    const call = mocks.createOneTimeCheckoutSession.mock.calls[0]?.[0] as {
      amountCents: number;
      metadata: Record<string, string>;
      idempotencyKey: string;
      successUrl: string;
      cancelUrl: string;
    };
    expect(call.amountCents).toBe(4_000);
    expect(call.metadata).toEqual({
      purchaseKind: REPLAY_PACK_KIND,
      tenantId: '7',
      packId: 'p10k',
      amountCents: '4000',
      buyerRef: 'u1',
    });
    expect(call.idempotencyKey).toMatch(/^replay-pack:7:p10k:/);
    // The return URL's own query string never rides through the processor.
    expect(call.successUrl).toBe('https://app.example.com/apps/insights?replay_pack={CHECKOUT_SESSION_ID}');
    expect(call.cancelUrl).toBe('https://app.example.com/apps/insights?replay_pack=cancelled');
  });

  it('traces checkout.started then checkout.session_created against the actor', async () => {
    await startReplayPackCheckout(fakeDb, stripeEnv, {
      tenantId: 7, buyerRef: 'u1', actorId: 'u1', packId: 'p50k', returnUrl: 'https://app.example.com/x',
    });
    const verbs = mocks.recordReplayTrace.mock.calls.map((call) => (call as unknown as [unknown, unknown, { verb: string; actorId: string }])[2]);
    expect(verbs.map((v) => v.verb)).toEqual(['replay.checkout.started', 'replay.checkout.session_created']);
    expect(verbs.every((v) => v.actorId === 'u1')).toBe(true);
  });

  it('answers 503 when payments are not configured', async () => {
    const noStripe = { STRIPE_SECRET_KEY: undefined, APP_URL: 'https://app.example.com' } as unknown as Env;
    const failure = startReplayPackCheckout(fakeDb, noStripe, {
      tenantId: 7, buyerRef: 'u1', packId: 'p10k', returnUrl: 'https://app.example.com/replay',
    });
    await expect(failure).rejects.toBeInstanceOf(ReplayCommerceError);
    await expect(failure).rejects.toMatchObject({ status: 503, message: 'Payments are not configured' });
  });

  it('404s an unknown pack before any trace or session', async () => {
    await expect(startReplayPackCheckout(fakeDb, stripeEnv, {
      tenantId: 7, buyerRef: 'u1', packId: 'does-not-exist', returnUrl: 'https://app.example.com/replay',
    })).rejects.toMatchObject({ status: 404 });
    expect(mocks.recordReplayTrace).not.toHaveBeenCalled();
    expect(mocks.createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  it('400s a return URL on another origin (no open redirect), before any trace or session', async () => {
    for (const returnUrl of ['https://evil.example.net/apps/insights', 'https://app.example.com.evil.net/x', 'http://app.example.com/x']) {
      await expect(startReplayPackCheckout(fakeDb, stripeEnv, {
        tenantId: 7, buyerRef: 'u1', packId: 'p10k', returnUrl,
      })).rejects.toMatchObject({ status: 400 });
    }
    expect(mocks.recordReplayTrace).not.toHaveBeenCalled();
    expect(mocks.createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  it('accepts any origin APP_URL lists', async () => {
    await startReplayPackCheckout(fakeDb, stripeEnv, {
      tenantId: 7, buyerRef: 'u1', packId: 'p10k', returnUrl: 'https://www.example.com/apps/insights',
    });
    expect(mocks.createOneTimeCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('400s a return URL that is not absolute', async () => {
    await expect(startReplayPackCheckout(fakeDb, stripeEnv, {
      tenantId: 7, buyerRef: 'u1', packId: 'p10k', returnUrl: '/relative',
    })).rejects.toMatchObject({ status: 400 });
  });
});

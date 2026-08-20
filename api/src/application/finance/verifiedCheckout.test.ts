/**
 * THE REFUSALS ARE THE FEATURE — and one of them is the whole security of paid
 * checkout.
 *
 * A hosted-checkout session id arrives from the buyer's address bar. Every check
 * here is the difference between "the money moved for this, for you" and handing a
 * paid product to whoever pastes a plausible string. The ownership check is the one
 * a hand-written copy forgets, so it is asserted from both directions: a mismatched
 * owner is refused, and a session that matches on one owner key but not another is
 * refused too — a partial match is exactly what a `&&` typo produces.
 *
 * The provider is stubbed because what is under test is the DECISION, not Stripe.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';
import { assertCovers, verifyPaidCheckout, type VerifiedCheckout } from './verifiedCheckout';

const retrieveCheckoutSession = vi.fn();

vi.mock('../../infrastructure/payment', () => ({
  buildPaymentProvider: () => ({ retrieveCheckoutSession }),
}));

class TestRefusal extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
const refuse = (message: string, status: 400 | 403 | 404) => new TestRefusal(message, status);

const MESSAGES = {
  notConfigured: 'not configured',
  notFound: 'not found',
  notPaid: 'not paid',
  wrongKind: 'wrong kind',
  notYours: 'not yours',
};

const env = { STRIPE_SECRET_KEY: 'sk_test_x' } as unknown as Env;

const session = (over: Record<string, unknown> = {}) => ({
  id: 'cs_1',
  paymentStatus: 'paid',
  amountTotalCents: 5_000,
  currency: 'USD',
  paymentIntentId: 'pi_1',
  subscriptionId: null,
  customerEmail: 'buyer@example.com',
  metadata: { purchaseKind: 'test_kind', buyerTenantId: '42' },
  ...over,
});

const verify = (over: Record<string, unknown> = {}) =>
  verifyPaidCheckout(env, {
    checkoutSessionId: 'cs_1',
    purchaseKind: 'test_kind',
    owner: { buyerTenantId: 42 },
    messages: MESSAGES,
    refuse,
    ...over,
  });

beforeEach(() => {
  retrieveCheckoutSession.mockReset();
});

describe('verifyPaidCheckout — what it refuses', () => {
  it('refuses before calling the processor when payments are not configured', async () => {
    await expect(
      verifyPaidCheckout({} as unknown as Env, {
        checkoutSessionId: 'cs_1',
        purchaseKind: 'test_kind',
        owner: {},
        messages: MESSAGES,
        refuse,
      }),
    ).rejects.toMatchObject({ message: 'not configured', status: 400 });
    expect(retrieveCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses a session the processor does not know', async () => {
    retrieveCheckoutSession.mockResolvedValue(null);
    await expect(verify()).rejects.toMatchObject({ message: 'not found', status: 404 });
  });

  it('refuses a session that has not been paid', async () => {
    retrieveCheckoutSession.mockResolvedValue(session({ paymentStatus: 'unpaid' }));
    await expect(verify()).rejects.toMatchObject({ message: 'not paid', status: 400 });
  });

  it('refuses another flow’s session, so an invoice payment cannot buy a listing', async () => {
    retrieveCheckoutSession.mockResolvedValue(
      session({ metadata: { purchaseKind: 'some_other_flow', buyerTenantId: '42' } }),
    );
    await expect(verify()).rejects.toMatchObject({ message: 'wrong kind', status: 400 });
  });

  // THE ONE A NAIVE IMPLEMENTATION FORGETS.
  it('refuses someone else’s paid session', async () => {
    retrieveCheckoutSession.mockResolvedValue(
      session({ metadata: { purchaseKind: 'test_kind', buyerTenantId: '99' } }),
    );
    await expect(verify()).rejects.toMatchObject({ message: 'not yours', status: 403 });
  });

  it('refuses when only SOME of the owner keys match', async () => {
    retrieveCheckoutSession.mockResolvedValue(
      session({ metadata: { purchaseKind: 'test_kind', siteId: '7', siteUserId: '1' } }),
    );
    await expect(verify({ owner: { siteId: 7, siteUserId: 2 } }))
      .rejects.toMatchObject({ message: 'not yours', status: 403 });
  });

  it('refuses a session carrying no owner metadata at all', async () => {
    retrieveCheckoutSession.mockResolvedValue(session({ metadata: { purchaseKind: 'test_kind' } }));
    await expect(verify()).rejects.toMatchObject({ message: 'not yours', status: 403 });
  });
});

describe('verifyPaidCheckout — what it returns', () => {
  it('compares numeric owner values as the strings the processor stores', async () => {
    retrieveCheckoutSession.mockResolvedValue(session());
    await expect(verify()).resolves.toMatchObject({ amountCents: 5_000 });
  });

  it('projects the payment reference, the captured amount and the email', async () => {
    retrieveCheckoutSession.mockResolvedValue(session());
    const verified = await verify();
    expect(verified.paymentRef).toBe('pi_1');
    expect(verified.amountCents).toBe(5_000);
    expect(verified.customerEmail).toBe('buyer@example.com');
    expect(verified.metadata.purchaseKind).toBe('test_kind');
  });

  it('falls back to the session id when there is no payment intent, so a retry is still recognisable', async () => {
    retrieveCheckoutSession.mockResolvedValue(session({ paymentIntentId: null }));
    await expect(verify()).resolves.toMatchObject({ paymentRef: 'cs_1' });
  });
});

describe('assertCovers', () => {
  const verified = { amountCents: 5_000 } as VerifiedCheckout;

  it('accepts a payment that covers the price', () => {
    expect(() => assertCovers(verified, 5_000, 'short', refuse)).not.toThrow();
  });

  it('accepts an overpayment', () => {
    expect(() => assertCovers(verified, 4_000, 'short', refuse)).not.toThrow();
  });

  // A buyer opening checkout at the old price and completing it after a rise.
  it('refuses a payment that no longer covers the price', () => {
    expect(() => assertCovers(verified, 6_000, 'short', refuse))
      .toThrow(expect.objectContaining({ message: 'short' }));
  });
});

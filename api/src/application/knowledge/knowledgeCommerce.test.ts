/**
 * A PRICED LISTING NOBODY COULD BUY.
 *
 * The checkout endpoint used to answer `{ requiresConfig: true }` and record
 * nothing, so `/install` 402'd forever and a seller could publish a price that was
 * never payable. These tests pin the behaviour that replaced it, and in particular
 * the four refusals that each would otherwise become a charge for something the
 * buyer already has, cannot use, or published themselves.
 *
 * The commission split is asserted separately because it is money: a seller under
 * the lifetime threshold must be charged NOTHING, on knowledge exactly as on a
 * creation, or the fee a seller pays depends on which page they published from.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { fakeDb } from '../../../test/fakeDb';
import {
  completeKnowledgeCheckout,
  holdsKnowledgePurchase,
  startKnowledgeCheckout,
  KNOWLEDGE_PURCHASE_KIND,
} from './knowledgeCommerce';

const createOneTimeCheckoutSession = vi.fn();
const retrieveCheckoutSession = vi.fn();

vi.mock('../../infrastructure/payment', () => ({
  buildPaymentProvider: () => ({ createOneTimeCheckoutSession, retrieveCheckoutSession }),
}));

const env = { STRIPE_SECRET_KEY: 'sk_test_x' } as unknown as Env;
const BUYER = { tenantId: 42, buyerUserId: 'u-buyer' };

const listing = (over: Record<string, unknown> = {}) => ({
  id: 'kn-1',
  tenantId: 7,
  createdBy: 'u-seller',
  title: 'Runbook',
  priceCents: 5_000,
  visibility: 'public',
  ...over,
});

const start = (db: FakeArg, over: Record<string, unknown> = {}) =>
  startKnowledgeCheckout(db as unknown as Db, env, {
    ...BUYER,
    listingId: 'kn-1',
    returnUrl: 'https://app.example.com/knowledge',
    ...over,
  });

type FakeArg = ReturnType<typeof fakeDb>;

beforeEach(() => {
  createOneTimeCheckoutSession.mockReset();
  retrieveCheckoutSession.mockReset();
  createOneTimeCheckoutSession.mockResolvedValue({ sessionId: 'cs_1', checkoutUrl: 'https://pay.example/cs_1' });
});

describe('startKnowledgeCheckout — what it refuses to sell', () => {
  it('refuses a listing that is not on the public market', async () => {
    await expect(start(fakeDb([[]]))).rejects.toMatchObject({ message: 'Listing not found', status: 404 });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses to take money for a free listing', async () => {
    await expect(start(fakeDb([[listing({ priceCents: 0 })]])))
      .rejects.toMatchObject({ status: 400 });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses to sell a workspace what it published itself', async () => {
    await expect(start(fakeDb([[listing({ tenantId: BUYER.tenantId })]])))
      .rejects.toMatchObject({ message: 'You already own what you published' });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses to charge twice for something already bought', async () => {
    // listing lookup, then the purchase lookup finds a row.
    await expect(start(fakeDb([[listing()], [{ id: 'p-1' }]])))
      .rejects.toMatchObject({ message: 'You already own this' });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses when payments are not configured, rather than granting for free', async () => {
    await expect(
      startKnowledgeCheckout(fakeDb([[listing()], []]) as unknown as Db, {} as unknown as Env, {
        ...BUYER, listingId: 'kn-1', returnUrl: 'https://app.example.com/knowledge',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('startKnowledgeCheckout — the session it mints', () => {
  it('names this flow and this buyer, so the return leg can be verified', async () => {
    const result = await start(fakeDb([[listing()], []]));
    expect(result).toEqual({ checkoutUrl: 'https://pay.example/cs_1' });

    const opts = createOneTimeCheckoutSession.mock.calls[0]![0];
    expect(opts.amountCents).toBe(5_000);
    expect(opts.metadata).toMatchObject({
      purchaseKind: KNOWLEDGE_PURCHASE_KIND,
      listingId: 'kn-1',
      buyerTenantId: '42',
    });
    // Same listing, same buyer, same key — a double-clicked button is one session.
    expect(opts.idempotencyKey).toBe('kn-checkout:kn-1:42');
    // The processor substitutes the id, so what comes back is a value it minted.
    expect(opts.successUrl).toContain('{CHECKOUT_SESSION_ID}');
  });

  it('keeps only the origin and path of the caller’s return url', async () => {
    await start(fakeDb([[listing()], []]), { returnUrl: 'https://app.example.com/knowledge?evil=1#x' });
    const opts = createOneTimeCheckoutSession.mock.calls[0]![0];
    expect(opts.successUrl).toBe('https://app.example.com/knowledge?checkout={CHECKOUT_SESSION_ID}&listing=kn-1');
    expect(opts.cancelUrl).toBe('https://app.example.com/knowledge?checkout=cancelled');
  });

  it('charges in the seller’s own currency rather than assuming USD', async () => {
    await start(fakeDb([[listing({ currency: 'EUR' })], []]));
    const opts = createOneTimeCheckoutSession.mock.calls[0]![0];
    expect(opts.currency).toBe('EUR');
  });

  it('falls back to USD for a listing published before currency was recorded', async () => {
    await start(fakeDb([[listing({ currency: null })], []]));
    const opts = createOneTimeCheckoutSession.mock.calls[0]![0];
    expect(opts.currency).toBe('USD');
  });
});

const paidSession = (over: Record<string, unknown> = {}) => ({
  id: 'cs_1',
  paymentStatus: 'paid',
  amountTotalCents: 5_000,
  currency: 'USD',
  paymentIntentId: 'pi_1',
  subscriptionId: null,
  customerEmail: 'buyer@example.com',
  metadata: { purchaseKind: KNOWLEDGE_PURCHASE_KIND, listingId: 'kn-1', buyerTenantId: '42' },
  ...over,
});

const complete = (db: FakeArg) =>
  completeKnowledgeCheckout(db as unknown as Db, env, { ...BUYER, checkoutSessionId: 'cs_1' });

describe('completeKnowledgeCheckout', () => {
  it('refuses a session raised for a different workspace', async () => {
    retrieveCheckoutSession.mockResolvedValue(
      paidSession({ metadata: { purchaseKind: KNOWLEDGE_PURCHASE_KIND, listingId: 'kn-1', buyerTenantId: '99' } }),
    );
    await expect(complete(fakeDb([]))).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a payment that no longer covers a raised price', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession({ amountTotalCents: 4_000 }));
    await expect(complete(fakeDb([[listing({ priceCents: 9_000 })]])))
      .rejects.toMatchObject({ message: 'The payment does not cover this listing' });
  });

  it('records the purchase against the buyer’s workspace with the processor’s own reference', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    // listing lookup → purchase insert → lifetime-earnings sum → ledger insert
    const db = fakeDb([[listing()], [{ id: 'p-9' }], [{ total: '0', sales: '0' }], []]);
    const result = await complete(db);

    expect(result).toMatchObject({ purchaseId: 'p-9', listingId: 'kn-1', priceCents: 5_000 });
    const insert = db.calls.find((call) => call.kind === 'insert');
    expect(insert?.payload).toMatchObject({
      listingId: 'kn-1',
      tenantId: 42,
      purchasedBy: 'u-buyer',
      priceCents: 5_000,
      provider: 'stripe',
      externalRef: 'pi_1',
    });
  });

  it('takes NOTHING from a seller who is under the lifetime threshold', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    const db = fakeDb([[listing()], [{ id: 'p-9' }], [{ total: '0', sales: '0' }], []]);
    const result = await complete(db);
    expect(result.commissionCents).toBe(0);
    expect(result.sellerCents).toBe(5_000);
  });

  it('takes the platform rate once the seller is past the threshold', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    // Lifetime earnings above the $200,000 default threshold.
    const db = fakeDb([[listing()], [{ id: 'p-9' }], [{ total: '25000000', sales: '900' }], []]);
    const result = await complete(db);
    expect(result.commissionCents).toBe(750); // 15% of $50.00
    expect(result.sellerCents).toBe(4_250);
  });

  it('credits the SELLER’s workspace, not the buyer’s — the earning must be payable', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    const db = fakeDb([[listing()], [{ id: 'p-9' }], [{ total: '25000000', sales: '900' }], []]);
    await complete(db);

    const ledger = db.calls.filter((call) => call.kind === 'insert').at(-1);
    const rows = ledger?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ tenantId: 7, accountKind: 'user', accountRef: 'u-seller', reference: 'kn-sale:p-9' });
    expect(rows[1]).toMatchObject({ tenantId: 7, accountKind: 'partner', accountRef: 'platform', reference: 'kn-fee:p-9' });
  });

  it('survives a replayed redirect: the conflicting insert returns nothing and the row is re-read', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    // listing → insert conflicts (no row) → re-read finds it → earnings → ledger
    const db = fakeDb([[listing()], [], [{ id: 'p-existing' }], [{ total: '0', sales: '0' }], []]);
    await expect(complete(db)).resolves.toMatchObject({ purchaseId: 'p-existing' });
  });
});

describe('holdsKnowledgePurchase', () => {
  it('is true only when a row exists for THIS workspace', async () => {
    await expect(holdsKnowledgePurchase(fakeDb([[{ id: 'p-1' }]]) as unknown as Db, 42, 'kn-1')).resolves.toBe(true);
    await expect(holdsKnowledgePurchase(fakeDb([[]]) as unknown as Db, 42, 'kn-1')).resolves.toBe(false);
  });
});

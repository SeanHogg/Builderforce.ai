/**
 * THE PAY GATE ON A MARKETPLACE LISTING.
 *
 * A priced creation is bought once through a dedicated Stripe checkout that
 * stamps `purchaseKind: marketplace_listing` and bills a quantity. The grant
 * itself is private; these tests pin the doors, the quantity clamp, and the
 * cover check so a bulk line cannot be completed against a unit-price session.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fakeDb, type FakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import {
  MARKETPLACE_LISTING_KIND,
  marketplaceListingQuantity,
  startListingCheckout,
  completeListingCheckout,
} from './listingCommerce';

const asDb = (fake: FakeDb): Db => fake as unknown as Db;

const mocks = vi.hoisted(() => ({
  createMarketplaceListingCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
}));

vi.mock('../../infrastructure/payment', () => ({
  buildPaymentProvider: () => ({
    createMarketplaceListingCheckoutSession: mocks.createMarketplaceListingCheckoutSession,
    retrieveCheckoutSession: mocks.retrieveCheckoutSession,
  }),
}));

const env = { STRIPE_SECRET_KEY: 'sk_test' } as never;

function listing(over: Record<string, unknown> = {}) {
  return {
    id: 'li_1',
    slug: 'onboarding',
    name: 'Onboarding board',
    priceCents: 2500,
    currency: 'USD',
    publisherRef: 'u-seller',
    visibility: 'public',
    tenantId: 7,
    body: {},
    ...over,
  };
}

function paidSession(over: Record<string, unknown> = {}) {
  return {
    id: 'cs_1',
    paymentStatus: 'paid',
    amountTotalCents: 2500,
    paymentIntentId: 'pi_1',
    customerEmail: 'buyer@example.com',
    metadata: {
      purchaseKind: MARKETPLACE_LISTING_KIND,
      listingId: 'li_1',
      listingSlug: 'onboarding',
      buyerRef: 'u-buyer',
      buyerTenantId: '9',
      tenantId: '9',
      quantity: '1',
    },
    ...over,
  };
}

beforeEach(() => {
  mocks.createMarketplaceListingCheckoutSession.mockReset();
  mocks.retrieveCheckoutSession.mockReset();
  mocks.createMarketplaceListingCheckoutSession.mockResolvedValue({
    sessionId: 'cs_1',
    checkoutUrl: 'https://pay.example/cs_1',
  });
});

describe('marketplaceListingQuantity', () => {
  it('defaults a missing or invalid value to 1', () => {
    expect(marketplaceListingQuantity(undefined)).toBe(1);
    expect(marketplaceListingQuantity(0)).toBe(1);
    expect(marketplaceListingQuantity(-3)).toBe(1);
    expect(marketplaceListingQuantity(1.5)).toBe(1);
    expect(marketplaceListingQuantity('nope')).toBe(1);
  });

  it('clamps a bulk order to 99 rather than billing an unbounded line', () => {
    expect(marketplaceListingQuantity(99)).toBe(99);
    expect(marketplaceListingQuantity(100)).toBe(99);
    expect(marketplaceListingQuantity('3')).toBe(3);
  });
});

describe('startListingCheckout', () => {
  it('opens a dedicated listing session with quantity, tenantId, and purchaseKind', async () => {
    await startListingCheckout(asDb(fakeDb([[listing()], []])), env, {
      tenantId: 9,
      buyerRef: 'u-buyer',
      buyerEmail: 'buyer@example.com',
      slug: 'onboarding',
      returnUrl: 'https://app.example/shop',
      quantity: 3,
    });
    expect(mocks.createMarketplaceListingCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 2500,
        currency: 'USD',
        productName: 'Onboarding board',
        quantity: 3,
        billingEmail: 'buyer@example.com',
        idempotencyKey: 'mp-checkout:li_1:u-buyer:3',
        metadata: expect.objectContaining({
          purchaseKind: MARKETPLACE_LISTING_KIND,
          listingSlug: 'onboarding',
          buyerRef: 'u-buyer',
          buyerTenantId: '9',
          tenantId: '9',
          quantity: '3',
        }),
      }),
    );
  });

  it('omits quantity from the idempotency key when billing a single copy', async () => {
    await startListingCheckout(asDb(fakeDb([[listing()], []])), env, {
      tenantId: 9,
      buyerRef: 'u-buyer',
      slug: 'onboarding',
      returnUrl: 'https://app.example/shop',
    });
    expect(mocks.createMarketplaceListingCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 1,
        idempotencyKey: 'mp-checkout:li_1:u-buyer',
      }),
    );
  });

  it('refuses a free listing — there is nothing to charge', async () => {
    await expect(startListingCheckout(asDb(fakeDb([[listing({ priceCents: 0 })]])), env, {
      tenantId: 9,
      buyerRef: 'u-buyer',
      slug: 'onboarding',
      returnUrl: 'https://app.example/shop',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/free/i) });
    expect(mocks.createMarketplaceListingCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('completeListingCheckout', () => {
  it('refuses a unit-price session that does not cover the billed quantity', async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue(paidSession({
      amountTotalCents: 2500,
      metadata: {
        purchaseKind: MARKETPLACE_LISTING_KIND,
        listingSlug: 'onboarding',
        buyerRef: 'u-buyer',
        buyerTenantId: '9',
        tenantId: '9',
        quantity: '3',
      },
    }));
    await expect(completeListingCheckout(asDb(fakeDb([[listing()]])), env, {
      tenantId: 9,
      buyerRef: 'u-buyer',
      checkoutSessionId: 'cs_1',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/does not cover/i) });
  });
});

/**
 * THE PAY GATE ON A MARKETPLACE SKILL.
 *
 * A paid skill used to grant on a client-supplied payment-intent id. These tests
 * are the replacement: the only way a priced skill lands is a processor session
 * that `verifyPaidCheckout` re-reads, and a replay of that session is still one
 * purchase. The take-rate numbers match listingCommerce / agentCommerce because
 * they share `resolveTakeRateBps` — a skill author under the lifetime threshold
 * pays nothing here exactly as they pay nothing on a creation.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fakeDb, type FakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

/** The shared double stands in for the real client (the suite's `as unknown as Db` convention). */
const asDb = (fake: FakeDb): Db => fake as unknown as Db;
import { SKILL_PURCHASE_KIND, startSkillCheckout, completeSkillCheckout } from './skillCommerce';

const mocks = vi.hoisted(() => ({
  createOneTimeCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
}));

vi.mock('../../infrastructure/payment', () => ({
  buildPaymentProvider: () => ({
    createOneTimeCheckoutSession: mocks.createOneTimeCheckoutSession,
    retrieveCheckoutSession: mocks.retrieveCheckoutSession,
  }),
}));

const env = { STRIPE_SECRET_KEY: 'sk_test' } as never;
const buyer = { buyerUserId: 'u-buyer', buyerEmail: 'buyer@example.com' };

function skill(over: Record<string, unknown> = {}) {
  return {
    slug: 'code-review',
    name: 'Code Review',
    authorId: 'u-seller',
    priceCents: 900,
    pricingModel: 'flat_fee',
    sellerTenantId: 7,
    ...over,
  };
}

function paidSession(over: Record<string, unknown> = {}) {
  return {
    id: 'cs_1',
    paymentStatus: 'paid',
    amountTotalCents: 900,
    paymentIntentId: 'pi_1',
    customerEmail: 'buyer@example.com',
    metadata: {
      purchaseKind: SKILL_PURCHASE_KIND,
      artifactType: 'skill',
      artifactSlug: 'code-review',
      buyerUserId: 'u-buyer',
    },
    ...over,
  };
}

beforeEach(() => {
  mocks.createOneTimeCheckoutSession.mockReset();
  mocks.retrieveCheckoutSession.mockReset();
  mocks.createOneTimeCheckoutSession.mockResolvedValue({
    sessionId: 'cs_1',
    checkoutUrl: 'https://pay.example/cs_1',
  });
});

describe('startSkillCheckout', () => {
  it('refuses an unpublished or missing skill', async () => {
    await expect(startSkillCheckout(asDb(fakeDb([[]])), env, {
      ...buyer, artifactType: 'skill', artifactSlug: 'missing', returnUrl: 'https://app.example/cart',
    })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a free skill — there is nothing to charge', async () => {
    await expect(startSkillCheckout(asDb(fakeDb([[skill({ priceCents: 0 })]])), env, {
      ...buyer, artifactType: 'skill', artifactSlug: 'code-review', returnUrl: 'https://app.example/cart',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/free/i) });
  });

  it('refuses a persona — personas have no price yet', async () => {
    await expect(startSkillCheckout(asDb(fakeDb([[{
      slug: 'coach', name: 'Coach', authorId: 'u-seller', sellerTenantId: 7,
    }]])), env, {
      ...buyer, artifactType: 'persona', artifactSlug: 'coach', returnUrl: 'https://app.example/cart',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/free/i) });
  });

  it('refuses the author buying their own skill', async () => {
    await expect(startSkillCheckout(asDb(fakeDb([[skill()]])), env, {
      buyerUserId: 'u-seller', artifactType: 'skill', artifactSlug: 'code-review', returnUrl: 'https://app.example/cart',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/already own/i) });
  });

  it('refuses a skill this person already bought', async () => {
    await expect(startSkillCheckout(asDb(fakeDb([[skill()], [{ id: 1 }]])), env, {
      ...buyer, artifactType: 'skill', artifactSlug: 'code-review', returnUrl: 'https://app.example/cart',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/already own/i) });
  });

  it('refuses when payments are not configured', async () => {
    await expect(startSkillCheckout(asDb(fakeDb([[skill()], []])), {} as never, {
      ...buyer, artifactType: 'skill', artifactSlug: 'code-review', returnUrl: 'https://app.example/cart',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not configured/i) });
  });

  it('mints a session tagged as a skill purchase, for this buyer, for this skill', async () => {
    const { checkoutUrl } = await startSkillCheckout(asDb(fakeDb([[skill()], []])), env, {
      ...buyer, artifactType: 'skill', artifactSlug: 'code-review', returnUrl: 'https://app.example/cart?from=drawer',
    });
    expect(checkoutUrl).toBe('https://pay.example/cs_1');
    expect(mocks.createOneTimeCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      amountCents: 900,
      productName: 'Code Review',
      billingEmail: 'buyer@example.com',
      // Origin + path only — a query string on the return url must not survive.
      successUrl: 'https://app.example/cart?checkout={CHECKOUT_SESSION_ID}&skill=code-review',
      cancelUrl: 'https://app.example/cart?checkout=cancelled',
      metadata: {
        purchaseKind: SKILL_PURCHASE_KIND,
        artifactType: 'skill',
        artifactSlug: 'code-review',
        buyerUserId: 'u-buyer',
      },
      idempotencyKey: 'mp-checkout:skill:code-review:u-buyer',
    }));
  });
});

describe('completeSkillCheckout', () => {
  it('refuses a session that is not paid — a forged id is not a grant', async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue(paidSession({ paymentStatus: 'unpaid' }));
    await expect(completeSkillCheckout(asDb(fakeDb([])), env, {
      buyerUserId: 'u-buyer', checkoutSessionId: 'cs_forged',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not been paid/i) });
  });

  it('refuses a session minted for a different flow', async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue(paidSession({
      metadata: { ...paidSession().metadata, purchaseKind: 'workforce_agent' },
    }));
    await expect(completeSkillCheckout(asDb(fakeDb([])), env, {
      buyerUserId: 'u-buyer', checkoutSessionId: 'cs_1',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not for a marketplace skill/i) });
  });

  it('refuses a session minted for someone else', async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue(paidSession());
    await expect(completeSkillCheckout(asDb(fakeDb([])), env, {
      buyerUserId: 'u-other', checkoutSessionId: 'cs_1',
    })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/someone else/i) });
  });

  it('refuses a session that underpays the current price', async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue(paidSession({ amountTotalCents: 100 }));
    await expect(completeSkillCheckout(asDb(fakeDb([[skill()]])), env, {
      buyerUserId: 'u-buyer', checkoutSessionId: 'cs_1',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/does not cover/i) });
  });

  it('records the processor payment as the purchase, not a client-supplied id', async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue(paidSession());
    // skill lookup, insert, lifetime earnings, ledger insert.
    const db = fakeDb([[skill()], [{ id: 9 }], [{ total: '0', sales: '0' }], []]);
    const purchase = await completeSkillCheckout(asDb(db), env, {
      buyerUserId: 'u-buyer', checkoutSessionId: 'cs_1',
    });
    expect(purchase).toEqual({
      purchaseId: 9,
      artifactType: 'skill',
      artifactSlug: 'code-review',
      priceCents: 900,
      commissionCents: 0,
      sellerCents: 900,
    });
    const insert = db.calls.find((call) => call.kind === 'insert');
    expect(insert?.payload).toEqual(expect.objectContaining({
      userId: 'u-buyer',
      artifactType: 'skill',
      artifactSlug: 'code-review',
      priceCents: 900,
      provider: 'stripe',
      externalRef: 'pi_1',
    }));
    expect(insert?.payload as Record<string, unknown>).not.toHaveProperty('stripePaymentIntentId');
  });

  it('credits the seller user-account, not a workspace, past the take-rate threshold', async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue(paidSession());
    const db = fakeDb([[skill()], [{ id: 9 }], [{ total: '20000000', sales: '5' }], []]);
    const purchase = await completeSkillCheckout(asDb(db), env, {
      buyerUserId: 'u-buyer', checkoutSessionId: 'cs_1',
    });
    expect(purchase.commissionCents).toBe(135); // 15% of 900
    expect(purchase.sellerCents).toBe(765);
    const ledger = db.calls.filter((call) => call.kind === 'insert').at(-1);
    expect(ledger?.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: 7,
        accountKind: 'user',
        accountRef: 'u-seller',
        amount: '765',
        reference: 'mp-sale:9',
      }),
      expect.objectContaining({
        tenantId: 7,
        accountKind: 'partner',
        accountRef: 'platform',
        amount: '135',
        reference: 'mp-fee:9',
      }),
    ]));
  });

  it('a replayed redirect re-reads the purchase rather than charging twice', async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue(paidSession());
    // insert returns nothing (conflict), then the existing-row re-read, then
    // earnings + ledger (onConflictDoNothing on the fee pair).
    const db = fakeDb([[skill()], [], [{ id: 9 }], [{ total: '0', sales: '0' }], []]);
    const purchase = await completeSkillCheckout(asDb(db), env, {
      buyerUserId: 'u-buyer', checkoutSessionId: 'cs_1',
    });
    expect(purchase.purchaseId).toBe(9);
  });
});

/**
 * THE CART DOOR ON A MARKETPLACE SKILL.
 *
 * POST /marketplace/purchase used to INSERT a paid skill on a client-supplied
 * payment-intent id. These tests are the replacement: a priced skill answers
 * 402 without a hosted session, a forged intent id is refused rather than
 * granted, and the only paid grant is start/complete checkout after the
 * processor has been re-read.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';

vi.mock('../middleware/webAuthMiddleware', () => ({
  webAuthMiddleware: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'u-buyer');
    await next();
  },
}));

const mocks = vi.hoisted(() => {
  class ListingError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ListingError';
      this.status = status;
    }
  }
  return {
    startSkillCheckout: vi.fn(),
    completeSkillCheckout: vi.fn(),
    ListingError,
  };
});

vi.mock('../../application/marketplace/skillCommerce', () => ({
  startSkillCheckout: mocks.startSkillCheckout,
  completeSkillCheckout: mocks.completeSkillCheckout,
  ListingError: mocks.ListingError,
}));

import { createMarketplaceRoutes } from './marketplaceRoutes';

/** Hono's third argument is the Worker env (`c.env`). Without it, checkout
 *  forwards `undefined` into skillCommerce and `expect.anything()` rejects it. */
const TEST_ENV = { STRIPE_SECRET_KEY: 'sk_test' };

const post = (path: string, body: unknown) =>
  createMarketplaceRoutes(fakeDb() as never).request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    TEST_ENV,
  );

beforeEach(() => {
  mocks.startSkillCheckout.mockReset();
  mocks.completeSkillCheckout.mockReset();
});

describe('POST /purchase', () => {
  it('answers 402 without a session for a priced skill', async () => {
    const app = createMarketplaceRoutes(fakeDb([
      [{ priceCents: 900, pricingModel: 'flat_fee' }],
      [],
    ]) as never);
    const res = await app.request('/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artifactType: 'skill', artifactSlug: 'code-review' }),
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: 'Purchase required',
      checkoutRequired: true,
      priceCents: 900,
    });
  });

  it('refuses a client-supplied payment intent id rather than granting', async () => {
    const app = createMarketplaceRoutes(fakeDb() as never);
    const res = await app.request('/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        artifactType: 'skill',
        artifactSlug: 'code-review',
        stripePaymentIntentId: 'pi_forged',
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/hosted checkout/i),
    });
  });

  it('records a free skill immediately', async () => {
    const app = createMarketplaceRoutes(fakeDb([
      [{ priceCents: 0, pricingModel: 'flat_fee' }],
      [],
      [],
    ]) as never);
    const res = await app.request('/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artifactType: 'skill', artifactSlug: 'free-review' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, priceCents: 0, pricingModel: 'flat_fee' });
  });

  it('records an unpriced persona at zero without checkout', async () => {
    const app = createMarketplaceRoutes(fakeDb([[], []]) as never);
    const res = await app.request('/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artifactType: 'persona', artifactSlug: 'coach' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, priceCents: 0, pricingModel: 'flat_fee' });
  });

  it('refuses agents on this route', async () => {
    const res = await post('/purchase', { artifactType: 'agent', artifactSlug: 'dev-1' });
    expect(res.status).toBe(400);
  });
});

describe('POST /checkout', () => {
  it('starts a hosted session for a priced skill', async () => {
    mocks.startSkillCheckout.mockResolvedValue({ checkoutUrl: 'https://pay.example/cs_1' });
    const res = await post('/checkout', {
      artifactType: 'skill',
      artifactSlug: 'code-review',
      returnUrl: 'https://app.example/cart',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkoutUrl: 'https://pay.example/cs_1' });
    expect(mocks.startSkillCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        buyerUserId: 'u-buyer',
        artifactType: 'skill',
        artifactSlug: 'code-review',
        returnUrl: 'https://app.example/cart',
      }),
    );
  });

  it('surfaces a ListingError from start as its own status', async () => {
    mocks.startSkillCheckout.mockRejectedValue(new mocks.ListingError('This skill is free — no checkout is needed', 400));
    const res = await post('/checkout', {
      artifactType: 'skill',
      artifactSlug: 'free-review',
      returnUrl: 'https://app.example/cart',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'This skill is free — no checkout is needed' });
  });
});

describe('POST /checkout/complete', () => {
  it('grants after the processor session is verified', async () => {
    mocks.completeSkillCheckout.mockResolvedValue({
      purchaseId: 9,
      artifactType: 'skill',
      artifactSlug: 'code-review',
      priceCents: 900,
    });
    const res = await post('/checkout/complete', { checkoutSessionId: 'cs_1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      purchased: true,
      purchase: {
        purchaseId: 9,
        artifactType: 'skill',
        artifactSlug: 'code-review',
        priceCents: 900,
      },
    });
  });

  it('refuses a forged unpaid session', async () => {
    mocks.completeSkillCheckout.mockRejectedValue(new mocks.ListingError('That checkout has not been paid', 400));
    const res = await post('/checkout/complete', { checkoutSessionId: 'cs_forged' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'That checkout has not been paid' });
  });
});

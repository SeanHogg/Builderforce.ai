import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The card lifecycle: validate → replace → remove.
 *
 * Two behaviours here are the whole reason migration 0346 exists, and both are
 * invisible to a type-checker:
 *
 *   - A REPLACE must not revoke premium access while the new card is confirmed.
 *     The naive implementation marks `pending` unconditionally, which suspends a
 *     paying tenant's premium for as long as the processor takes.
 *   - A REMOVE must detach the card WE recorded, not every card on the customer.
 *
 * Both are about which call is (or isn't) made, so they're asserted against the
 * real route with the service + provider mocked.
 */

const CALLER_TENANT = 5;

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-abc');
    c.set('tenantId', CALLER_TENANT);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));
vi.mock('../middleware/webAuthMiddleware', () => ({
  webAuthMiddleware: async (_c: any, next: any) => next(),
}));

const mocks = vi.hoisted(() => ({
  getCardValidation: vi.fn(),
  markCardPending: vi.fn(async () => undefined),
  clearCardValidation: vi.fn(async () => undefined),
  detachCards: vi.fn(async () => 1),
  createCardValidationSession: vi.fn(async () => ({
    sessionId: 'cs_1', checkoutUrl: 'https://stripe.test/cs_1', externalCustomerId: 'cus_1',
  })),
}));

vi.mock('../../application/tenant/cardValidationService', async (orig) => ({
  ...(await orig() as object),
  getCardValidation: mocks.getCardValidation,
  markCardPending: mocks.markCardPending,
  clearCardValidation: mocks.clearCardValidation,
}));
vi.mock('../../infrastructure/payment', () => ({
  buildPaymentProvider: () => ({ detachCards: mocks.detachCards, createCardValidationSession: mocks.createCardValidationSession }),
}));

import { createTenantRoutes } from './tenantRoutes';

/** A tenant row. `subscription` makes the card the live billing instrument. */
function makeTenantService(over: Record<string, unknown> = {}) {
  return {
    getTenant: vi.fn(async (id: number) => ({
      id,
      billingEmail: 'billing@acme.test',
      externalCustomerId: 'cus_1',
      externalSubscriptionId: null,
      billingStatus: 'none',
      toPlain: () => ({ id, name: 'Acme', plan: 'free' }),
      effectivePlan: () => 'free',
      ...over,
    })),
  };
}

const routes = (ts: ReturnType<typeof makeTenantService>) => createTenantRoutes(ts as any, {} as any);

/** The route reads APP_URL for the checkout return links, so an env is required. */
const ENV = { APP_URL: 'https://app.test' } as Record<string, unknown>;

const NO_CARD = { status: 'none', validatedAt: null, brand: null, last4: null, paymentMethodId: null };
const VALIDATED = {
  status: 'validated', validatedAt: new Date(), brand: 'visa', last4: '4242', paymentMethodId: 'pm_old',
};

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockClear();
  mocks.detachCards.mockResolvedValue(1);
});

describe('POST /:id/card-validation — add vs replace', () => {
  it('marks pending for a FIRST-time validation (no access to lose)', async () => {
    mocks.getCardValidation.mockResolvedValue(NO_CARD);

    const res = await routes(makeTenantService()).request(`/${CALLER_TENANT}/card-validation`, { method: 'POST' }, ENV);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ validated: false, status: 'pending' });
    expect(mocks.markCardPending).toHaveBeenCalledTimes(1);
  });

  it('does NOT suspend premium when REPLACING an already-validated card', async () => {
    mocks.getCardValidation.mockResolvedValue(VALIDATED);

    const res = await routes(makeTenantService()).request(`/${CALLER_TENANT}/card-validation`, { method: 'POST' }, ENV);

    // The heart of the fix: no `pending` write, so `isCardValidated` stays true and
    // premium keeps working on the OLD card until the new one is confirmed.
    expect(mocks.markCardPending).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ validated: true, status: 'validated' });
  });

  it('does not detach anything at request time — the swap happens on the webhook', async () => {
    mocks.getCardValidation.mockResolvedValue(VALIDATED);
    await routes(makeTenantService()).request(`/${CALLER_TENANT}/card-validation`, { method: 'POST' }, ENV);
    // Detaching here would revoke the card still serving the tenant.
    expect(mocks.detachCards).not.toHaveBeenCalled();
  });
});

describe('DELETE /:id/card-validation — removal', () => {
  it('detaches BY ID and clears the record', async () => {
    mocks.getCardValidation.mockResolvedValue(VALIDATED);

    const res = await routes(makeTenantService()).request(`/${CALLER_TENANT}/card-validation`, { method: 'DELETE' }, ENV);

    expect(res.status).toBe(200);
    expect(mocks.detachCards).toHaveBeenCalledWith({ paymentMethodId: 'pm_old', externalCustomerId: 'cus_1' });
    expect(mocks.clearCardValidation).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ status: 'none', validated: false });
  });

  it('falls back to the customer sweep for a pre-0346 row with no stored id', async () => {
    mocks.getCardValidation.mockResolvedValue({ ...VALIDATED, paymentMethodId: null });

    await routes(makeTenantService()).request(`/${CALLER_TENANT}/card-validation`, { method: 'DELETE' }, ENV);

    expect(mocks.detachCards).toHaveBeenCalledWith({ paymentMethodId: null, externalCustomerId: 'cus_1' });
  });

  it('REFUSES while a paid subscription still bills the card', async () => {
    mocks.getCardValidation.mockResolvedValue(VALIDATED);
    const ts = makeTenantService({ externalSubscriptionId: 'sub_1', billingStatus: 'active' });

    const res = await routes(ts).request(`/${CALLER_TENANT}/card-validation`, { method: 'DELETE' }, ENV);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'card_backs_active_subscription' });
    // Nothing touched — a half-performed removal would break renewal billing.
    expect(mocks.detachCards).not.toHaveBeenCalled();
    expect(mocks.clearCardValidation).not.toHaveBeenCalled();
  });

  it('does NOT clear our record when the processor detach fails', async () => {
    // Detach-then-clear ordering: if the processor call throws we must not have
    // revoked premium while the card is still held there.
    mocks.getCardValidation.mockResolvedValue(VALIDATED);
    mocks.detachCards.mockRejectedValue(new Error('Stripe is down'));

    const res = await routes(makeTenantService()).request(`/${CALLER_TENANT}/card-validation`, { method: 'DELETE' }, ENV);

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(mocks.clearCardValidation).not.toHaveBeenCalled();
  });

  it('blocks a cross-tenant removal', async () => {
    mocks.getCardValidation.mockResolvedValue(VALIDATED);
    const res = await routes(makeTenantService()).request('/999/card-validation', { method: 'DELETE' }, ENV);
    expect(res.status).toBe(403);
    expect(mocks.detachCards).not.toHaveBeenCalled();
  });
});

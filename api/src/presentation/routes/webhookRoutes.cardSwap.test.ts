import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The webhook half of a gap-free card REPLACE.
 *
 * `POST /card-validation` deliberately leaves an already-validated tenant's
 * verdict alone, so premium keeps working on the OLD card while the new one is
 * verified (see tenantRoutes.cardLifecycle.test.ts). The swap therefore has to
 * complete HERE: once `card.validated` confirms the new card, the displaced one
 * is detached.
 *
 * The ordering is the whole point — detaching before confirmation would revoke
 * the card still serving the tenant, which is the gap this design removes.
 */

const mocks = vi.hoisted(() => ({
  markCardValidatedByCustomer: vi.fn(),
  markCardValidationFailedByCustomer: vi.fn(async () => true),
  clearCardValidationByCustomer: vi.fn(async () => ({ known: true, clearedPaymentMethodId: null as string | null })),
  detachCards: vi.fn(async () => 1),
  parseWebhook: vi.fn(),
  markDiscountRedeemed: vi.fn(async () => undefined),
  recordReferralConversion: vi.fn(async () => undefined),
}));

vi.mock('../../application/tenant/cardValidationService', async (orig) => ({
  ...(await orig() as object),
  markCardValidatedByCustomer: mocks.markCardValidatedByCustomer,
  markCardValidationFailedByCustomer: mocks.markCardValidationFailedByCustomer,
  clearCardValidationByCustomer: mocks.clearCardValidationByCustomer,
}));
vi.mock('../../application/tenant/discountCodeService', () => ({
  markDiscountRedeemed: mocks.markDiscountRedeemed,
}));
vi.mock('../../application/sales/recordReferralConversion', () => ({
  recordReferralConversion: mocks.recordReferralConversion,
}));
vi.mock('../../infrastructure/database/connection', () => ({
  buildDatabase: vi.fn(() => ({})),
}));

import { createWebhookRoutes } from './webhookRoutes';

const tenantService = { handleWebhookEvent: vi.fn(async () => undefined) };
const provider = { parseWebhook: mocks.parseWebhook, detachCards: mocks.detachCards };

const routes = () => createWebhookRoutes(tenantService as never, provider as never);

function cardValidatedPost() {
  return routes().request(
    '/payment',
    { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' },
    {} as Record<string, unknown>,
  );
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockClear();
  mocks.detachCards.mockResolvedValue(1);
  mocks.parseWebhook.mockResolvedValue({
    type: 'card.validated',
    externalCustomerId: 'cus_1',
    externalSubscriptionId: '',
    paymentBrand: 'visa',
    paymentLast4: '4242',
    paymentMethodId: 'pm_new',
    raw: {},
  });
});

describe('card.validated — replace swap', () => {
  it('detaches the DISPLACED card once the new one is confirmed', async () => {
    mocks.markCardValidatedByCustomer.mockResolvedValue({ known: true, replacedPaymentMethodId: 'pm_old' });

    const res = await cardValidatedPost();

    expect(res.status).toBe(200);
    // The old card, not the one just validated.
    expect(mocks.detachCards).toHaveBeenCalledWith({ paymentMethodId: 'pm_old' });
  });

  it('detaches NOTHING on a first-time validation', async () => {
    mocks.markCardValidatedByCustomer.mockResolvedValue({ known: true, replacedPaymentMethodId: null });

    await cardValidatedPost();

    expect(mocks.detachCards).not.toHaveBeenCalled();
  });

  it('passes the payment-method id through so it can be persisted', async () => {
    mocks.markCardValidatedByCustomer.mockResolvedValue({ known: true, replacedPaymentMethodId: null });

    await cardValidatedPost();

    expect(mocks.markCardValidatedByCustomer).toHaveBeenCalledWith(
      expect.anything(),
      'cus_1',
      { brand: 'visa', last4: '4242', paymentMethodId: 'pm_new' },
      { tenantId: undefined, billingEmail: null },
    );
  });

  it('still acknowledges the webhook when the detach fails', async () => {
    // A failed detach orphans a card at the processor — annoying, but far better
    // than 500ing and having the provider retry a validation already written.
    mocks.markCardValidatedByCustomer.mockResolvedValue({ known: true, replacedPaymentMethodId: 'pm_old' });
    mocks.detachCards.mockRejectedValue(new Error('Stripe is down'));

    const res = await cardValidatedPost();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ processed: true });
  });

  it('reports an unknown customer without detaching anything', async () => {
    mocks.markCardValidatedByCustomer.mockResolvedValue({ known: false, replacedPaymentMethodId: null });

    const res = await cardValidatedPost();

    await expect(res.json()).resolves.toMatchObject({ processed: false });
    expect(mocks.detachCards).not.toHaveBeenCalled();
  });

  it('leaves the failure path alone (no swap on a declined card)', async () => {
    mocks.parseWebhook.mockResolvedValue({
      type: 'card.validation_failed',
      externalCustomerId: 'cus_1',
      externalSubscriptionId: '',
      raw: {},
    });

    const res = await cardValidatedPost();

    expect(res.status).toBe(200);
    expect(mocks.markCardValidationFailedByCustomer).toHaveBeenCalledTimes(1);
    // A declined replacement must not cost the tenant the card that still works.
    expect(mocks.detachCards).not.toHaveBeenCalled();
  });
});

describe('subscription.cancelled — card retention', () => {
  beforeEach(() => {
    mocks.parseWebhook.mockResolvedValue({
      type: 'subscription.cancelled',
      externalCustomerId: 'cus_1',
      externalSubscriptionId: 'sub_1',
      raw: {},
    });
  });

  it('keeps the validated card for metered usage on the Free plan', async () => {
    const res = await cardValidatedPost();

    expect(res.status).toBe(200);
    expect(mocks.clearCardValidationByCustomer).not.toHaveBeenCalled();
    expect(mocks.detachCards).not.toHaveBeenCalled();
  });

  it('also leaves the card alone on a non-terminal subscription event', async () => {
    // past_due is a grace period, not an ending — revoking the card there would
    // make recovering from a failed payment harder, not easier.
    mocks.parseWebhook.mockResolvedValue({
      type: 'subscription.past_due',
      externalCustomerId: 'cus_1',
      externalSubscriptionId: 'sub_1',
      raw: {},
    });

    await cardValidatedPost();

    expect(mocks.clearCardValidationByCustomer).not.toHaveBeenCalled();
    expect(mocks.detachCards).not.toHaveBeenCalled();
  });
});

describe('subscription.activated — discount redemption', () => {
  it('finalizes the reserved discount only after the signed activation event', async () => {
    mocks.parseWebhook.mockResolvedValue({
      type: 'subscription.activated',
      externalCustomerId: 'cus_1',
      externalSubscriptionId: 'sub_1',
      tenantId: 7,
      discountRedemptionId: 'redemption-1',
      raw: {},
    });

    const res = await cardValidatedPost();

    expect(res.status).toBe(200);
    expect(tenantService.handleWebhookEvent).toHaveBeenCalled();
    expect(mocks.markDiscountRedeemed).toHaveBeenCalledWith(expect.anything(), 7, 'redemption-1');
  });
});

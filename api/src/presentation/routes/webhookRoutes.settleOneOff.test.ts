/**
 * THE ACKNOWLEDGEMENT CONTRACT, WHICH IS EASY TO GET BACKWARDS.
 *
 * Three paid flows now settle through one helper, and the temptation in each was
 * to answer a failure with a 500 so the processor retries. That is wrong twice
 * over, and both mistakes are silent:
 *
 *   · the COMMON "failure" is the redirect having already recorded the purchase,
 *     so retrying asks the processor to redeliver a completed sale forever;
 *   · an event whose signed metadata is incomplete cannot be settled by
 *     redelivering the same event, so retrying it is a loop with no exit.
 *
 * So every path here answers `received: true`, and only `processed` varies. These
 * tests exist because the next person to add a fourth flow will copy this shape,
 * and the shape is the part that must not drift.
 */
/**
 * THE ACKNOWLEDGEMENT CONTRACT, WHICH IS EASY TO GET BACKWARDS.
 *
 * Three paid flows now settle through one helper, and the temptation in each was
 * to answer a failure with a 500 so the processor retries. That is wrong twice
 * over, and both mistakes are silent:
 *
 *   · the COMMON "failure" is the redirect having already recorded the purchase,
 *     so retrying asks the processor to redeliver a completed sale forever;
 *   · an event whose signed metadata is incomplete cannot be settled by
 *     redelivering the same event, so retrying it is a loop with no exit.
 *
 * So every path here answers `received: true`, and only `processed` varies. These
 * tests exist because the next person to add a fourth flow will copy this shape,
 * and the shape is the part that must not drift.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  completeListingCheckout: vi.fn(),
  completeKnowledgeCheckout: vi.fn(),
  settleInvoiceCheckout: vi.fn(),
  reportCaughtError: vi.fn(),
  parseWebhook: vi.fn(),
}));

vi.mock('../../application/marketplace/listingCommerce', () => ({
  completeListingCheckout: mocks.completeListingCheckout,
}));
vi.mock('../../application/knowledge/knowledgeCommerce', () => ({
  completeKnowledgeCheckout: mocks.completeKnowledgeCheckout,
}));
vi.mock('../../application/finance/receivables', () => ({
  settleInvoiceCheckout: mocks.settleInvoiceCheckout,
}));
vi.mock('../../application/observability/caughtErrorReporter', () => ({
  reportCaughtError: mocks.reportCaughtError,
}));
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: vi.fn(() => ({})) }));
vi.mock('../../application/tenant/discountCodeService', () => ({ markDiscountRedeemed: vi.fn() }));
vi.mock('../../application/sales/recordReferralConversion', () => ({ recordReferralConversion: vi.fn() }));

import { createWebhookRoutes } from './webhookRoutes';

const tenantService = { handleWebhookEvent: vi.fn(async () => undefined) };

/** Drive one provider event through the router and read the acknowledgement. */
async function deliver(event: Record<string, unknown>) {
  mocks.parseWebhook.mockResolvedValue(event);
  const router = createWebhookRoutes(tenantService as never, { parseWebhook: mocks.parseWebhook } as never);
  const res = await router.request(
    '/payment',
    { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' },
    {} as Record<string, unknown>,
  );
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

const KNOWLEDGE = {
  type: 'knowledge.purchased',
  purchaseKind: 'knowledge_listing',
  checkoutSessionId: 'cs_1',
  buyerUserId: 'u-buyer',
  tenantId: 42,
  externalCustomerId: 'cus_1',
  externalSubscriptionId: '',
  raw: {},
};

beforeEach(() => {
  mocks.completeListingCheckout.mockReset();
  mocks.completeKnowledgeCheckout.mockReset();
  mocks.settleInvoiceCheckout.mockReset();
  mocks.reportCaughtError.mockReset();
});

describe('knowledge.purchased — the close-the-tab path', () => {
  it('settles the purchase the redirect never got to record', async () => {
    mocks.completeKnowledgeCheckout.mockResolvedValue({ purchaseId: 'p-1' });
    const { status, body } = await deliver(KNOWLEDGE);
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, processed: true });
    expect(mocks.completeKnowledgeCheckout).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      tenantId: 42, buyerUserId: 'u-buyer', checkoutSessionId: 'cs_1',
    });
  });

  it('acknowledges without settling when the metadata names no buyer', async () => {
    const { body } = await deliver({ ...KNOWLEDGE, buyerUserId: undefined });
    expect(body).toEqual({ received: true, processed: false });
    expect(mocks.completeKnowledgeCheckout).not.toHaveBeenCalled();
  });

  it('acknowledges without settling when the metadata names no workspace', async () => {
    const { body } = await deliver({ ...KNOWLEDGE, tenantId: undefined });
    expect(body).toEqual({ received: true, processed: false });
    expect(mocks.completeKnowledgeCheckout).not.toHaveBeenCalled();
  });

  // The redirect got there first. This is success wearing a throw.
  it('acknowledges a refusal rather than asking for a redelivery loop', async () => {
    mocks.completeKnowledgeCheckout.mockRejectedValue(new Error('You already own this'));
    const { status, body } = await deliver(KNOWLEDGE);
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, processed: false });
    expect(mocks.reportCaughtError).toHaveBeenCalled();
  });
});

describe('the other two flows keep the same contract', () => {
  it('settles a creation listing', async () => {
    mocks.completeListingCheckout.mockResolvedValue({});
    const { body } = await deliver({
      type: 'listing.purchased', checkoutSessionId: 'cs_2', buyerRef: 'u-b', tenantId: 7,
      externalCustomerId: 'cus_1', externalSubscriptionId: '', raw: {},
    });
    expect(body).toEqual({ received: true, processed: true });
  });

  // An invoice reports whether it APPLIED, and a second arrival applies nothing.
  it('reports a receivable that had already been settled as unprocessed', async () => {
    mocks.settleInvoiceCheckout.mockResolvedValue({ applied: false });
    const { body } = await deliver({
      type: 'invoice.paid', checkoutSessionId: 'cs_3', invoiceRef: 'INV-1', tenantId: 7,
      externalCustomerId: 'cus_1', externalSubscriptionId: '', raw: {},
    });
    expect(body).toEqual({ received: true, processed: false });
  });
});

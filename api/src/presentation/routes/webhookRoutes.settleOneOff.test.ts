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
  recordMarketplaceListingEvent: vi.fn(),
  completeKnowledgeCheckout: vi.fn(),
  completeSkillCheckout: vi.fn(),
  settleInvoiceCheckout: vi.fn(),
  reportCaughtError: vi.fn(),
  parseWebhook: vi.fn(),
}));

vi.mock('../../application/marketplace/listingCommerce', () => ({
  completeListingCheckout: mocks.completeListingCheckout,
  MARKETPLACE_LISTING_KIND: 'marketplace_listing',
  recordMarketplaceListingEvent: mocks.recordMarketplaceListingEvent,
}));
vi.mock('../../application/knowledge/knowledgeCommerce', () => ({
  completeKnowledgeCheckout: mocks.completeKnowledgeCheckout,
  KNOWLEDGE_PURCHASE_KIND: 'knowledge_listing',
}));
vi.mock('../../application/marketplace/skillCommerce', () => ({
  completeSkillCheckout: mocks.completeSkillCheckout,
  SKILL_PURCHASE_KIND: 'marketplace_skill',
}));
vi.mock('../../application/finance/receivables', () => ({
  settleInvoiceCheckout: mocks.settleInvoiceCheckout,
  TENANT_INVOICE_KIND: 'tenant_invoice',
}));
vi.mock('../../application/observability/caughtErrorReporter', () => ({
  reportCaughtError: mocks.reportCaughtError,
}));
vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: vi.fn(() => ({})),
}));
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

// A knowledge sale arrives as an ordinary self-named `checkout.completed`; the
// purchase registry settles it by kind from the signed metadata.
const KNOWLEDGE_META = { purchaseKind: 'knowledge_listing', listingId: 'l-1', buyerTenantId: '42', tenantId: '42', buyerUserId: 'u-buyer' };
const KNOWLEDGE = {
  type: 'checkout.completed',
  purchaseKind: 'knowledge_listing',
  checkoutSessionId: 'cs_1',
  tenantId: 42,
  metadata: KNOWLEDGE_META,
  externalCustomerId: 'cus_1',
  externalSubscriptionId: '',
  raw: {},
};

beforeEach(() => {
  mocks.completeListingCheckout.mockReset();
  mocks.completeKnowledgeCheckout.mockReset();
  mocks.completeSkillCheckout.mockReset();
  mocks.settleInvoiceCheckout.mockReset();
  mocks.reportCaughtError.mockReset();
});

describe('checkout.completed knowledge_listing — the close-the-tab path', () => {
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
    const { body } = await deliver({ ...KNOWLEDGE, metadata: { ...KNOWLEDGE_META, buyerUserId: '' } });
    expect(body).toEqual({ received: true, processed: false });
    expect(mocks.completeKnowledgeCheckout).not.toHaveBeenCalled();
  });

  it('acknowledges without settling when the metadata names no workspace', async () => {
    const { body } = await deliver({ ...KNOWLEDGE, metadata: { ...KNOWLEDGE_META, buyerTenantId: '' } });
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

describe('invoice.paid — keeps its trigger name, settles through the same registry', () => {
  const INVOICE = {
    type: 'invoice.paid', purchaseKind: 'tenant_invoice', checkoutSessionId: 'cs_3', tenantId: 7,
    metadata: { purchaseKind: 'tenant_invoice', invoiceRef: 'INV-1', invoiceTenantId: '7' },
    externalCustomerId: 'cus_1', externalSubscriptionId: '', raw: {},
  };

  it('settles the receivable for the SELLER tenant named in the metadata', async () => {
    mocks.settleInvoiceCheckout.mockResolvedValue({ applied: true });
    const { body } = await deliver(INVOICE);
    expect(body).toEqual({ received: true, processed: true });
    expect(mocks.settleInvoiceCheckout).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      tenantId: 7, invoiceRef: 'INV-1', checkoutSessionId: 'cs_3',
    });
  });

  // An invoice reports whether it APPLIED, and a second arrival applies nothing.
  it('reports a receivable that had already been settled as unprocessed', async () => {
    mocks.settleInvoiceCheckout.mockResolvedValue({ applied: false });
    const { body } = await deliver(INVOICE);
    expect(body).toEqual({ received: true, processed: false });
  });
});

const SKILL = {
  type: 'checkout.completed',
  purchaseKind: 'marketplace_skill',
  checkoutSessionId: 'cs_skill',
  metadata: {
    purchaseKind: 'marketplace_skill',
    artifactType: 'skill',
    artifactSlug: 'code-review',
    buyerUserId: 'u-buyer',
  },
  externalCustomerId: 'cus_1',
  externalSubscriptionId: '',
  raw: {},
};

describe('checkout.completed marketplace_skill — the close-the-tab path', () => {
  it('settles a skill purchase without requiring a workspace', async () => {
    mocks.completeSkillCheckout.mockResolvedValue({ purchaseId: 9 });
    const { status, body } = await deliver(SKILL);
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, processed: true });
    expect(mocks.completeSkillCheckout).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      buyerUserId: 'u-buyer', checkoutSessionId: 'cs_skill',
    });
  });

  it('acknowledges without settling when the metadata names no buyer', async () => {
    const { body } = await deliver({
      ...SKILL,
      metadata: { purchaseKind: 'marketplace_skill', artifactType: 'skill', artifactSlug: 'code-review' },
    });
    expect(body).toEqual({ received: true, processed: false });
    expect(mocks.completeSkillCheckout).not.toHaveBeenCalled();
  });

  it('acknowledges a refusal rather than asking for a redelivery loop', async () => {
    mocks.completeSkillCheckout.mockRejectedValue(new Error('You already own this'));
    const { status, body } = await deliver(SKILL);
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, processed: false });
    expect(mocks.reportCaughtError).toHaveBeenCalled();
  });
});

const LISTING = {
  type: 'checkout.completed',
  purchaseKind: 'marketplace_listing',
  checkoutSessionId: 'cs_listing',
  metadata: {
    purchaseKind: 'marketplace_listing',
    listingSlug: 'onboarding',
    buyerRef: 'u-buyer',
    buyerTenantId: '7',
    tenantId: '7',
    quantity: '2',
  },
  externalCustomerId: 'cus_1',
  externalSubscriptionId: '',
  raw: {},
};

describe('checkout.completed marketplace_listing — the close-the-tab path', () => {
  it('settles a listing purchase from signed metadata', async () => {
    mocks.completeListingCheckout.mockResolvedValue({});
    const { status, body } = await deliver(LISTING);
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, processed: true });
    expect(mocks.completeListingCheckout).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      tenantId: 7, buyerRef: 'u-buyer', checkoutSessionId: 'cs_listing',
    });
  });

  it('acknowledges without settling when the metadata names no buyer', async () => {
    const { body } = await deliver({
      ...LISTING,
      metadata: { purchaseKind: 'marketplace_listing', listingSlug: 'onboarding', buyerTenantId: '7' },
    });
    expect(body).toEqual({ received: true, processed: false });
    expect(mocks.completeListingCheckout).not.toHaveBeenCalled();
  });

  it('acknowledges a refusal rather than asking for a redelivery loop', async () => {
    mocks.completeListingCheckout.mockRejectedValue(new Error('You already own this'));
    const { status, body } = await deliver(LISTING);
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, processed: false });
    expect(mocks.reportCaughtError).toHaveBeenCalled();
  });
});

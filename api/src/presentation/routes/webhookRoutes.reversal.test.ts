/**
 * `purchase.reversed` at the webhook route: a reverser that succeeds acknowledges, one that
 * fails answers 500 (the processor redelivers; reversers are idempotent), an unknown kind is
 * acknowledged unprocessed, and a failed upstream lookup while parsing is a 500, NOT the
 * "Invalid signature" 401 that made the failure look like a forged event.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reverser: vi.fn(),
  parseWebhook: vi.fn(),
  reportCaughtError: vi.fn(),
}));

vi.mock('../../application/billing/purchaseRegistry', () => ({
  addonRecorderFor: () => null,
  oneOffSettlerFor: () => null,
  purchaseReverserFor: (kind: string) => (kind === 'marketplace_voice' ? mocks.reverser : null),
}));
vi.mock('../../application/observability/caughtErrorReporter', () => ({ reportCaughtError: mocks.reportCaughtError }));
vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: vi.fn(() => ({})),
}));
vi.mock('../../application/tenant/discountCodeService', () => ({ markDiscountRedeemed: vi.fn() }));
vi.mock('../../application/sales/recordReferralConversion', () => ({ recordReferralConversion: vi.fn() }));

import { createWebhookRoutes } from './webhookRoutes';
import { WebhookUpstreamError } from '../../infrastructure/payment/PaymentProvider';

const tenantService = { handleWebhookEvent: vi.fn(async () => undefined) };

async function post() {
  const router = createWebhookRoutes(tenantService as never, { parseWebhook: mocks.parseWebhook } as never);
  const res = await router.request(
    '/payment',
    { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' },
    {} as Record<string, unknown>,
  );
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

const reversed = (purchaseKind: string) => ({
  type: 'purchase.reversed', purchaseKind, tenantId: 9, metadata: { buyerTenantId: '9', cloneId: '7' },
  externalCustomerId: '', externalSubscriptionId: '', raw: {},
});

beforeEach(() => {
  mocks.reverser.mockReset();
  mocks.parseWebhook.mockReset();
  mocks.reportCaughtError.mockReset();
});

describe('purchase.reversed', () => {
  it('runs the reverser with the signed metadata and acknowledges', async () => {
    mocks.parseWebhook.mockResolvedValue(reversed('marketplace_voice'));
    mocks.reverser.mockResolvedValue(true);
    const { status, body } = await post();
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, processed: true });
    expect(mocks.reverser.mock.calls[0]![2]).toEqual({ metadata: { buyerTenantId: '9', cloneId: '7' } });
  });

  it('answers 500 when the reverser fails, so the processor redelivers', async () => {
    mocks.parseWebhook.mockResolvedValue(reversed('marketplace_voice'));
    mocks.reverser.mockRejectedValue(new Error('db down'));
    expect((await post()).status).toBe(500);
  });

  it('acknowledges an unknown kind without processing it', async () => {
    mocks.parseWebhook.mockResolvedValue(reversed('knowledge_listing'));
    const { status, body } = await post();
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, processed: false });
    expect(mocks.reverser).not.toHaveBeenCalled();
  });
});

describe('parseWebhook failures', () => {
  it('a payment-intent lookup failure is a 500 (retry), not an invalid signature', async () => {
    mocks.parseWebhook.mockRejectedValue(new WebhookUpstreamError('Stripe payment_intent lookup failed: 503'));
    expect((await post()).status).toBe(500);
  });

  it('a genuine signature failure is still 401', async () => {
    mocks.parseWebhook.mockRejectedValue(new Error('bad signature'));
    expect((await post()).status).toBe(401);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const reverse = vi.fn();
vi.mock('../studio/voiceCommerce', () => ({
  VOICE_PURCHASE_KIND: 'marketplace_voice',
  completeVoiceCheckout: vi.fn(),
  reverseVoicePurchase: (...a: unknown[]) => reverse(...a),
}));

import { purchaseReverserFor } from './purchaseRegistry';

beforeEach(() => reverse.mockReset());

describe('purchase reversal registry', () => {
  it('routes a voice refund/dispute to the voice reverser with the signed buyer + clone', async () => {
    reverse.mockResolvedValue({ reversed: true, licenseId: 4 });
    const fn = purchaseReverserFor('marketplace_voice')!;
    expect(await fn({} as never, {} as never, { metadata: { buyerTenantId: '2', cloneId: '9' } })).toBe(true);
    expect(reverse.mock.calls[0]![2]).toEqual({ tenantId: 2, cloneId: 9 });
  });

  it('acknowledges incomplete metadata without reversing, and ignores unknown kinds', async () => {
    const fn = purchaseReverserFor('marketplace_voice')!;
    expect(await fn({} as never, {} as never, { metadata: { cloneId: '9' } })).toBeNull();
    expect(reverse).not.toHaveBeenCalled();
    expect(purchaseReverserFor('workforce_agent')).toBeNull();
  });
});

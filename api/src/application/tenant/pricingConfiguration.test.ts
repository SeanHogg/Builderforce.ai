import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING_DOCUMENT, validatePricingDocument } from './pricingConfiguration';

describe('business phone public pricing', () => {
  it('publishes the consolidated BurnRateOS phone offer', () => {
    expect(DEFAULT_PRICING_DOCUMENT.businessPhone).toEqual({
      activation: 19.95, monthly: 9.95, includedMinutes: 200, includedSms: 300, includedMms: 15,
      overagePerMinute: 0.05, overagePerSms: 0.012, overagePerMms: 0.10, eligiblePlans: ['pro', 'teams'],
    });
  });

  it('adds phone defaults to previously published pricing documents', () => {
    const legacy = { ...DEFAULT_PRICING_DOCUMENT, businessPhone: undefined };
    expect(validatePricingDocument(legacy).businessPhone).toEqual(DEFAULT_PRICING_DOCUMENT.businessPhone);
  });

  it('rejects negative phone prices', () => {
    expect(() => validatePricingDocument({ ...DEFAULT_PRICING_DOCUMENT, businessPhone: { ...DEFAULT_PRICING_DOCUMENT.businessPhone, monthly: -1 } })).toThrow('Invalid business phone pricing');
  });
});

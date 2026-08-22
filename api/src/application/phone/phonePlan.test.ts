/**
 * The conversion from the price an operator TYPED to the price a customer is
 * CHARGED. It is the seam where a phone product silently bills something other
 * than what its own pricing page quotes, so it is the part worth pinning down.
 */

import { describe, expect, it } from 'vitest';
import { allowanceCents, ratesFromPricing } from './phonePlan';
import { rateFor } from './commsRates';

/** The shipped default pricing document's phone block. */
const PRICING = {
  activation: 19.95,
  monthly: 9.95,
  includedMinutes: 200,
  includedSms: 300,
  includedMms: 15,
  overagePerMinute: 0.05,
  overagePerSms: 0.012,
  overagePerMms: 0.10,
  eligiblePlans: ['pro', 'teams'] as Array<'pro' | 'teams'>,
};

describe('rates from published pricing', () => {
  it('quotes the customer the price the pricing page shows', () => {
    const rates = ratesFromPricing(PRICING);
    expect(rateFor('sms_segment', rates)).toBeCloseTo(1.2, 10);
    expect(rateFor('voice_minute', rates)).toBeCloseTo(5, 10);
    expect(rateFor('mms_message', rates)).toBeCloseTo(10, 10);
  });

  it('keeps a sub-cent unit price sub-cent', () => {
    // 1.2¢ rounded to 1¢ at the unit would under-bill every SMS by 17%, and
    // rounded to 2¢ would over-bill by 67%. The rounding belongs on the TOTAL,
    // which is `debitComms`'s job — a two-segment message costs 2.4¢ → 3¢, not
    // 2 × 2¢.
    const rates = ratesFromPricing(PRICING);
    expect(Number.isInteger(rateFor('sms_segment', rates))).toBe(false);
    expect(Math.ceil(2 * rateFor('sms_segment', rates))).toBe(3);
  });

  it('leaves the extra-number rent on the card default', () => {
    // The pricing document has never quoted a price for a SECOND business line,
    // so this must fall through to the card rather than resolve to 0 — a 0 here
    // is a free number the platform pays a carrier for every month.
    const rates = ratesFromPricing(PRICING);
    expect(rates.number_month).toBeUndefined();
    expect(rateFor('number_month', rates)).toBeGreaterThan(0);
  });

  it('passes a zero overage through rather than falling back to the card', () => {
    // An operator who publishes "SMS included, no overage" means it. Falling back
    // to the default card here would bill a customer who was quoted free.
    const rates = ratesFromPricing({ ...PRICING, overagePerSms: 0 });
    expect(rateFor('sms_segment', rates)).toBe(0);
  });
});

describe('the monthly allowance', () => {
  it('is worth exactly what the pricing page promises, at the quoted rates', () => {
    // 200 min × 5¢ + 300 SMS × 1.2¢ + 15 MMS × 10¢ = 1000 + 360 + 150.
    expect(allowanceCents(PRICING)).toBe(1510);
  });

  it('buys the whole included SMS quota and no less', () => {
    const rates = ratesFromPricing(PRICING);
    const sms = rateFor('sms_segment', rates);
    expect(allowanceCents(PRICING)).toBeGreaterThanOrEqual(PRICING.includedSms * sms);
  });

  it('rounds up so the grant is never a cent short of the quote', () => {
    // 1 SMS at 1.2¢ is 1.2 cents of value; granting 1 would leave the customer
    // unable to send the one message they were promised.
    const odd = { ...PRICING, includedMinutes: 0, includedMms: 0, includedSms: 1 };
    expect(allowanceCents(odd)).toBe(2);
  });

  it('is zero when nothing is included', () => {
    expect(allowanceCents({ ...PRICING, includedMinutes: 0, includedSms: 0, includedMms: 0 })).toBe(0);
  });
});

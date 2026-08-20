/**
 * THE QUOTE MUST AGREE WITH THE CHARGE.
 *
 * A fee model exists to be shown to the person paying it, which means the only failure
 * that matters is a quote that differs from what `grantListing` actually takes. The
 * rounding assertion below is the one nobody would think to write and the one that would
 * have bitten: a quote that floored where the charge rounds is wrong by a cent on about
 * half of all sales — too small to notice, large enough to make every reconciliation
 * fail.
 */
import { describe, expect, it } from 'vitest';
import { bpsToPercent, feeCentsFor, quoteFromRate } from './platformFees';
import type { ResolvedTakeRate } from '../marketplace/listingCommerce';

const rate = (over: Partial<ResolvedTakeRate> = {}): ResolvedTakeRate => ({
  bps: 1500,
  lifetimeCents: 25_000_000,
  thresholdCents: 20_000_000,
  underThreshold: false,
  ...over,
});

describe('feeCentsFor', () => {
  it('is the EXACT expression the charge path uses', () => {
    // `grantListing`: Math.round((priceCents * takeRateBps) / 10_000)
    expect(feeCentsFor(10_000, 1500)).toBe(1_500);
    expect(feeCentsFor(999, 1500)).toBe(Math.round((999 * 1500) / 10_000));
  });

  it('ROUNDS rather than floors — the cent that reconciliation turns on', () => {
    // 333 * 1500 / 10000 = 49.95. Floor would say 49 and the charge says 50.
    expect(feeCentsFor(333, 1500)).toBe(50);
  });

  it('is zero at a zero rate, which is the whole point of the threshold', () => {
    expect(feeCentsFor(10_000_000, 0)).toBe(0);
  });

  it('refuses to produce a number from a non-number', () => {
    expect(feeCentsFor(Number.NaN, 1500)).toBe(0);
    expect(feeCentsFor(10_000, Number.NaN)).toBe(0);
    expect(feeCentsFor(-500, 1500)).toBe(0);
  });
});

describe('quoteFromRate — the fee, and WHY', () => {
  it('waives the fee under the threshold and says how far there is to go', () => {
    const quote = quoteFromRate(
      rate({ bps: 0, lifetimeCents: 5_000_000, underThreshold: true }),
      100_000,
      { sellerKnown: true, configuredBps: 1500 },
    );
    expect(quote).toMatchObject({
      feeBps: 0,
      feeCents: 0,
      netCents: 100_000,
      waived: true,
      reason: 'under_threshold',
      remainingToThresholdCents: 15_000_000,
      // The rate they WILL pay, which is what makes "you are paying nothing" mean
      // something rather than read as "there is no fee here".
      configuredBps: 1500,
    });
  });

  it('charges the configured rate past the threshold', () => {
    const quote = quoteFromRate(rate(), 100_000, { sellerKnown: true, configuredBps: 1500 });
    expect(quote).toMatchObject({
      feeBps: 1500,
      feeCents: 15_000,
      netCents: 85_000,
      waived: false,
      reason: 'standard_rate',
      remainingToThresholdCents: 0,
    });
  });

  it('never claims a platform-owned listing "passed the threshold"', () => {
    // The resolver collapses "past the threshold" and "nobody to exempt" into the same
    // `underThreshold: false`, which is correct for PRICING and a fabrication for
    // EXPLAINING. `sellerKnown` is what separates them.
    const quote = quoteFromRate(
      rate({ lifetimeCents: 0 }),
      100_000,
      { sellerKnown: false, configuredBps: 1500 },
    );
    expect(quote.reason).toBe('platform_listing');
    expect(quote.feeCents).toBe(15_000);
  });

  it('always reconciles: fee + net = gross', () => {
    for (const gross of [0, 1, 333, 999, 100_000, 4_999_999]) {
      for (const bps of [0, 250, 1500, 5000]) {
        const quote = quoteFromRate(rate({ bps }), gross, { sellerKnown: true, configuredBps: 1500 });
        expect(quote.feeCents + quote.netCents).toBe(quote.grossCents);
      }
    }
  });

  it('never returns a negative net, even at the clamp ceiling', () => {
    const quote = quoteFromRate(rate({ bps: 5000 }), 999, { sellerKnown: true, configuredBps: 5000 });
    expect(quote.netCents).toBeGreaterThanOrEqual(0);
  });

  it('treats a missing gross as a rate enquiry rather than an error', () => {
    const quote = quoteFromRate(rate(), Number.NaN, { sellerKnown: true, configuredBps: 1500 });
    expect(quote).toMatchObject({ grossCents: 0, feeCents: 0, netCents: 0, feeBps: 1500 });
  });
});

describe('bpsToPercent', () => {
  it('reads basis points as a percentage', () => {
    expect(bpsToPercent(1500)).toBe(15);
    expect(bpsToPercent(1050)).toBe(10.5);
    expect(bpsToPercent(0)).toBe(0);
  });
});

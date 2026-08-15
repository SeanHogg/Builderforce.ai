import { describe, it, expect } from 'vitest';
import {
  platformTakeRateBps,
  resolveTakeRateBps,
  takeRateThresholdCents,
} from './listingCommerce';
import type { Env } from '../../env';

const env = (over: Partial<Env> = {}) => ({ ...over }) as Env;

/** Fakes the ONE indexed SUM `lifetimeSellerCents` runs. */
function dbEarning(totalCents: number) {
  return {
    select: () => ({
      from: () => ({
        where: async () => [{ total: String(totalCents), sales: '3' }],
      }),
    }),
  } as never;
}

describe('platformTakeRateBps', () => {
  it('defaults to 1500 bps', () => {
    expect(platformTakeRateBps(env())).toBe(1500);
  });

  it('clamps a nonsense env var to the default rather than inverting a seller into debt', () => {
    // A misconfigured `"50%"` must not become a 5000% commission.
    expect(platformTakeRateBps(env({ MARKETPLACE_TAKE_RATE_BPS: '50%' }))).toBe(1500);
    expect(platformTakeRateBps(env({ MARKETPLACE_TAKE_RATE_BPS: '-100' }))).toBe(1500);
    expect(platformTakeRateBps(env({ MARKETPLACE_TAKE_RATE_BPS: '99999' }))).toBe(1500);
  });

  it('honours a valid override', () => {
    expect(platformTakeRateBps(env({ MARKETPLACE_TAKE_RATE_BPS: '1000' }))).toBe(1000);
  });
});

describe('takeRateThresholdCents', () => {
  it('defaults to $200,000 lifetime', () => {
    expect(takeRateThresholdCents(env())).toBe(20_000_000);
  });

  it('honours an override and refuses a negative one', () => {
    expect(takeRateThresholdCents(env({ MARKETPLACE_TAKE_RATE_THRESHOLD_CENTS: '5000' }))).toBe(5000);
    expect(takeRateThresholdCents(env({ MARKETPLACE_TAKE_RATE_THRESHOLD_CENTS: '-1' }))).toBe(20_000_000);
  });
});

describe('resolveTakeRateBps', () => {
  it('takes NOTHING from a seller under the threshold', async () => {
    // The load-bearing claim: a fee charged before somebody has made real money
    // is a fee charged for the privilege of trying.
    const rate = await resolveTakeRateBps(dbEarning(418_000), env(), { tenantId: 1, ref: 'u1' });
    expect(rate.bps).toBe(0);
    expect(rate.underThreshold).toBe(true);
    expect(rate.lifetimeCents).toBe(418_000);
    expect(rate.thresholdCents).toBe(20_000_000);
  });

  it('charges the configured rate once the seller is past it', async () => {
    const rate = await resolveTakeRateBps(dbEarning(20_000_000), env(), { tenantId: 1, ref: 'u1' });
    expect(rate.bps).toBe(1500);
    expect(rate.underThreshold).toBe(false);
  });

  it('treats the threshold as exclusive — exactly at it, the fee starts', async () => {
    const under = await resolveTakeRateBps(dbEarning(19_999_999), env(), { tenantId: 1, ref: 'u1' });
    expect(under.bps).toBe(0);
    const at = await resolveTakeRateBps(dbEarning(20_000_000), env(), { tenantId: 1, ref: 'u1' });
    expect(at.bps).toBe(1500);
  });

  it('charges a platform-owned listing the configured rate', async () => {
    // Nobody to credit and nobody to exempt; the platform's cut of its own
    // listing is still recorded rather than silently zero.
    const rate = await resolveTakeRateBps(dbEarning(0), env(), { tenantId: null, ref: null });
    expect(rate.bps).toBe(1500);
    expect(rate.underThreshold).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  resolveMemberSpendCapMillicents,
  seatCostControlsEnabled,
  usdToMillicents,
  millicentsToUsd,
  MILLICENTS_PER_USD,
} from './memberSpend';

describe('resolveMemberSpendCapMillicents — effective per-seat cap', () => {
  it('member explicit cap wins over the tenant default', () => {
    expect(resolveMemberSpendCapMillicents(500_000, 200_000)).toBe(500_000);
  });

  it('member null inherits the tenant default', () => {
    expect(resolveMemberSpendCapMillicents(null, 200_000)).toBe(200_000);
    expect(resolveMemberSpendCapMillicents(undefined, 200_000)).toBe(200_000);
  });

  it('member -1 means unlimited, overriding a team default', () => {
    expect(resolveMemberSpendCapMillicents(-1, 200_000)).toBeNull();
  });

  it('no member cap AND no tenant default → unlimited (null)', () => {
    expect(resolveMemberSpendCapMillicents(null, null)).toBeNull();
    expect(resolveMemberSpendCapMillicents(null, -1)).toBeNull();
  });

  it('member 0 is an explicit "no paid spend" cap (not unlimited)', () => {
    expect(resolveMemberSpendCapMillicents(0, 200_000)).toBe(0);
  });
});

describe('seatCostControlsEnabled — Teams only', () => {
  it('is true only for Teams', () => {
    expect(seatCostControlsEnabled('teams')).toBe(true);
    expect(seatCostControlsEnabled('pro')).toBe(false);
    expect(seatCostControlsEnabled('free')).toBe(false);
  });
});

describe('millicents ⇄ USD', () => {
  it('round-trips dollars through the millicent unit', () => {
    expect(usdToMillicents(5)).toBe(5 * MILLICENTS_PER_USD);
    expect(millicentsToUsd(usdToMillicents(12.34))).toBeCloseTo(12.34, 5);
  });
});

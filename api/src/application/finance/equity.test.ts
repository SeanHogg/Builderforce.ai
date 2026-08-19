/**
 * The ownership arithmetic, tested where it is pure.
 *
 * Every number a cap table shows is produced by one of the four functions below,
 * and all four live in `@builderforce/creation-canvas-contract` so the API's
 * projection and the canvas card compute them identically. Testing them here is
 * testing what a founder actually reads — the DB round-trip around them adds
 * nothing this can get wrong.
 *
 * What each case pins is a REFUSAL as much as a result: a grant reports zero
 * before its cliff, a fold drops a position that has gone to zero, and a
 * conversion that has no price to work from returns no shares rather than
 * dividing by zero and reporting infinity.
 */

import { describe, expect, it } from 'vitest';
import {
  cliffDate,
  convertInstrument,
  foldEquityEvents,
  vestedQuantity,
  type ConvertibleTerms,
  type EquityLedgerEvent,
  type VestingSchedule,
} from '@builderforce/creation-canvas-contract';

const FOUR_YEAR_ONE_YEAR_CLIFF: VestingSchedule = {
  startAt: '2025-01-01',
  durationMonths: 48,
  cliffMonths: 12,
  frequency: 'monthly',
  acceleration: 'double-trigger',
};

describe('vestedQuantity', () => {
  it('vests nothing before the cliff — not a proportion, nothing', () => {
    expect(vestedQuantity(48_000, FOUR_YEAR_ONE_YEAR_CLIFF, '2025-11-30')).toBe(0);
  });

  it('vests the whole cliff portion at once on the cliff date', () => {
    expect(vestedQuantity(48_000, FOUR_YEAR_ONE_YEAR_CLIFF, '2026-01-01')).toBe(12_000);
  });

  it('vests one tranche per month after the cliff', () => {
    expect(vestedQuantity(48_000, FOUR_YEAR_ONE_YEAR_CLIFF, '2026-04-01')).toBe(15_000);
  });

  it('never exceeds the grant once the term is done', () => {
    expect(vestedQuantity(48_000, FOUR_YEAR_ONE_YEAR_CLIFF, '2031-01-01')).toBe(48_000);
  });

  it('floors a quarterly schedule to completed quarters, never part of one', () => {
    const quarterly: VestingSchedule = { ...FOUR_YEAR_ONE_YEAR_CLIFF, frequency: 'quarterly' };
    // Fourteen months in is four completed quarters, not four and two thirds.
    expect(vestedQuantity(48_000, quarterly, '2026-03-01')).toBe(12_000);
    expect(vestedQuantity(48_000, quarterly, '2026-04-01')).toBe(15_000);
  });

  it('treats a schedule-less grant as fully vested — purchased shares are owned', () => {
    const purchased: VestingSchedule = {
      startAt: '2025-01-01', durationMonths: null, cliffMonths: null, frequency: 'none', acceleration: 'none',
    };
    expect(vestedQuantity(1_000_000, purchased, '2025-01-02')).toBe(1_000_000);
  });

  it('vests nothing at all with no start date, rather than guessing one', () => {
    const undated: VestingSchedule = { ...FOUR_YEAR_ONE_YEAR_CLIFF, startAt: null };
    expect(vestedQuantity(48_000, undated, '2030-01-01')).toBe(0);
  });

  it('accelerates only when the CALLER says a trigger fired', () => {
    expect(vestedQuantity(48_000, FOUR_YEAR_ONE_YEAR_CLIFF, '2025-06-01', true)).toBe(48_000);
    expect(vestedQuantity(48_000, { ...FOUR_YEAR_ONE_YEAR_CLIFF, acceleration: 'none' }, '2025-06-01', true)).toBe(0);
  });
});

describe('cliffDate', () => {
  it('lands the cliff a whole number of months after the start', () => {
    expect(cliffDate(FOUR_YEAR_ONE_YEAR_CLIFF)).toBe('2026-01-01');
  });

  it('clamps a month-end start rather than rolling it into the next month', () => {
    expect(cliffDate({ ...FOUR_YEAR_ONE_YEAR_CLIFF, startAt: '2025-01-31', cliffMonths: 1 })).toBe('2025-02-28');
  });

  it('is null with no cliff, so a trigger reports unbound instead of watching today', () => {
    expect(cliffDate({ ...FOUR_YEAR_ONE_YEAR_CLIFF, cliffMonths: 0 })).toBeNull();
  });
});

describe('foldEquityEvents', () => {
  const ledger: EquityLedgerEvent[] = [
    { eventKind: 'issue', shareClassRef: 'common', fromHolderRef: null, toHolderRef: 'ana', quantity: 6_000_000, effectiveAt: '2025-01-01' },
    { eventKind: 'issue', shareClassRef: 'common', fromHolderRef: null, toHolderRef: 'ben', quantity: 4_000_000, effectiveAt: '2025-01-01' },
    { eventKind: 'transfer', shareClassRef: 'common', fromHolderRef: 'ben', toHolderRef: 'ana', quantity: 1_000_000, effectiveAt: '2025-06-01' },
    { eventKind: 'repurchase', shareClassRef: 'common', fromHolderRef: 'ben', toHolderRef: null, quantity: 3_000_000, effectiveAt: '2025-09-01' },
  ];

  it('folds issuances and transfers into positions', () => {
    const positions = foldEquityEvents(ledger, '2025-07-01');
    expect(positions).toEqual([
      { holderRef: 'ana', shareClassRef: 'common', quantity: 7_000_000 },
      { holderRef: 'ben', shareClassRef: 'common', quantity: 3_000_000 },
    ]);
  });

  it('answers as of a past date from the same traversal', () => {
    const march = foldEquityEvents(ledger, '2025-03-01');
    expect(march.find((position) => position.holderRef === 'ana')?.quantity).toBe(6_000_000);
  });

  it('drops a holder folded to zero rather than reporting a row of nothing', () => {
    const positions = foldEquityEvents(ledger, '2025-12-01');
    expect(positions.map((position) => position.holderRef)).toEqual(['ana']);
  });

  it('moves an exercise between two classes as one event', () => {
    const positions = foldEquityEvents([
      { eventKind: 'issue', shareClassRef: 'pool', fromHolderRef: null, toHolderRef: 'cara', quantity: 40_000, effectiveAt: '2025-01-01' },
      { eventKind: 'exercise', shareClassRef: 'pool', toShareClassRef: 'common', fromHolderRef: 'cara', toHolderRef: 'cara', quantity: 10_000, effectiveAt: '2026-02-01' },
    ]);
    expect(positions).toEqual([
      { holderRef: 'cara', shareClassRef: 'pool', quantity: 30_000 },
      { holderRef: 'cara', shareClassRef: 'common', quantity: 10_000 },
    ]);
  });

  it('gives a pool increase to nobody — an unallocated pool is not owned', () => {
    expect(foldEquityEvents([
      { eventKind: 'pool-increase', shareClassRef: 'pool', fromHolderRef: null, toHolderRef: null, quantity: 1_000_000, effectiveAt: '2025-01-01' },
    ])).toEqual([]);
  });
});

describe('convertInstrument', () => {
  const safe: ConvertibleTerms = {
    kind: 'safe', principal: 500_000, valuationCap: 5_000_000, discountPercent: 20,
    postMoney: true, interestRate: null, issuedAt: '2025-01-01',
  };

  it('takes the cap when the cap price is the better of the two', () => {
    // 10M shares at a $5M cap is $0.50; a $2.00 round less 20% is $1.60.
    const result = convertInstrument(safe, 2, 10_000_000, '2026-01-01');
    expect(result.basis).toBe('cap');
    expect(result.conversionPrice).toBe(0.5);
    expect(result.shares).toBe(1_000_000);
  });

  it('takes the discount when the round prices below the cap', () => {
    const result = convertInstrument({ ...safe, valuationCap: 50_000_000 }, 2, 10_000_000, '2026-01-01');
    expect(result.basis).toBe('discount');
    expect(result.conversionPrice).toBeCloseTo(1.6);
  });

  it('accrues simple interest on a note and none on a SAFE', () => {
    const note: ConvertibleTerms = { ...safe, kind: 'note', interestRate: 8, valuationCap: null, discountPercent: null };
    const converted = convertInstrument(note, 2, 10_000_000, '2026-01-01');
    expect(converted.convertedAmount).toBeCloseTo(540_000, 0);
    expect(convertInstrument(safe, 2, 10_000_000, '2026-01-01').convertedAmount).toBe(500_000);
  });

  it('returns no shares rather than infinity when there is no price to work from', () => {
    const result = convertInstrument({ ...safe, valuationCap: null, discountPercent: null }, 0, 0, '2026-01-01');
    expect(result.shares).toBe(0);
    expect(result.conversionPrice).toBe(0);
  });
});

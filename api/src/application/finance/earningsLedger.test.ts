/**
 * ONE ACCOUNT, FIVE MEANINGS — and `entry_kind` cannot tell them apart.
 *
 * Every movement in a person's statement lands on `('user', <id>, 'usd_cents')`, and
 * `payout` is written both when escrow RELEASES money to a freelancer and when money
 * LEAVES to their bank. Both positive, same account, same entry kind. Only the reference
 * separates them, and getting that backwards would show somebody their earnings as
 * withdrawals — a statement that says they have been paid nothing and taken everything.
 *
 * So the classifier gets a table, and the table walks every `entry_kind` the kernel
 * declares rather than only the ones this report expects. A new kind added upstream must
 * fall into `adjustment`, not into a silent hole.
 */
import { describe, expect, it } from 'vitest';
import {
  EARNINGS_PERIODS,
  classifyLedgerEntry,
  defaultEarningsRange,
  isEarningsPeriod,
  isEarningKind,
  parseRangeDate,
} from './earningsLedger';
import { escrowLedgerReference } from '../marketplace/escrow';

/** Every `entry_kind` `ledger_entries` documents (kernel.ts). */
const ALL_ENTRY_KINDS = [
  'grant', 'spend', 'refund', 'payout', 'commission', 'adjustment', 'hold', 'maintenance_cost',
] as const;

describe('classifyLedgerEntry', () => {
  it('reads a marketplace sale credit as a sale', () => {
    expect(classifyLedgerEntry('commission', 'mp-sale:41')).toBe('sale');
  });

  it('reads a refund as a refund, whatever its reference', () => {
    expect(classifyLedgerEntry('refund', 'mp-refund:41')).toBe('refund');
    expect(classifyLedgerEntry('refund', null)).toBe('refund');
  });

  it('tells an ESCROW RELEASE from a BANK WITHDRAWAL — the whole reason it exists', () => {
    // Written by `milestones.ts` when escrow releases money TO the freelancer.
    expect(classifyLedgerEntry('payout', escrowLedgerReference('m-1', 'release'))).toBe('escrow_release');
    // Written by `PayoutAccountService.pay` when money LEAVES to their bank.
    expect(classifyLedgerEntry('payout', 'mp-payout:7:u1:900')).toBe('withdrawal');
  });

  it('treats a payout with no reference as a withdrawal, not an earning', () => {
    // The safe reading: crediting an unattributable payout as an EARNING would inflate
    // what somebody appears to have made. Under-reporting an earning is visible and
    // fixable; over-reporting one is a number somebody plans around.
    expect(classifyLedgerEntry('payout', null)).toBe('withdrawal');
    expect(classifyLedgerEntry('payout', '')).toBe('withdrawal');
  });

  it('is total over every entry kind the kernel declares', () => {
    for (const kind of ALL_ENTRY_KINDS) {
      const classified = classifyLedgerEntry(kind, null);
      expect(['sale', 'escrow_release', 'refund', 'withdrawal', 'adjustment']).toContain(classified);
    }
  });

  it('drops an unknown future entry kind into adjustment rather than a hole', () => {
    expect(classifyLedgerEntry('some_new_kind_from_2027', null)).toBe('adjustment');
    expect(classifyLedgerEntry('hold', null)).toBe('adjustment');
  });

  it('agrees with isEarningKind about which side of the line each kind falls', () => {
    expect(isEarningKind(classifyLedgerEntry('commission', 'mp-sale:1'))).toBe(true);
    expect(isEarningKind(classifyLedgerEntry('payout', 'escrow:m:release'))).toBe(true);
    expect(isEarningKind(classifyLedgerEntry('refund', null))).toBe(true);
    expect(isEarningKind(classifyLedgerEntry('payout', 'mp-payout:1'))).toBe(false);
    expect(isEarningKind(classifyLedgerEntry('grant', null))).toBe(false);
  });

  it('is not fooled by a reference that merely CONTAINS the escrow token', () => {
    // `startsWith`, not `includes`: a memo-shaped reference mentioning escrow must not
    // reclassify a bank withdrawal as money earned.
    expect(classifyLedgerEntry('payout', 'mp-payout:for-escrow:12')).toBe('withdrawal');
  });
});

describe('periods', () => {
  it('accepts only the four declared periods', () => {
    for (const period of EARNINGS_PERIODS) expect(isEarningsPeriod(period)).toBe(true);
    // The guard is what keeps an arbitrary string out of `date_trunc`.
    for (const bad of ['day', 'decade', '"; drop table', '', null, 3]) {
      expect(isEarningsPeriod(bad)).toBe(false);
    }
  });
});

describe('the range', () => {
  it('defaults to twelve months ending after today, so today is inside it', () => {
    const now = new Date('2026-08-20T13:45:00Z');
    const { from, to } = defaultEarningsRange(now);
    expect(to.toISOString()).toBe('2026-08-21T00:00:00.000Z');
    expect(from.toISOString()).toBe('2025-08-21T00:00:00.000Z');
    expect(now.getTime()).toBeGreaterThan(from.getTime());
    expect(now.getTime()).toBeLessThan(to.getTime());
  });

  it('refuses a value that is not a date rather than passing Invalid Date to SQL', () => {
    const fallback = new Date('2026-01-01T00:00:00Z');
    expect(parseRangeDate('not-a-date', fallback)).toBe(fallback);
    expect(parseRangeDate('', fallback)).toBe(fallback);
    expect(parseRangeDate(undefined, fallback)).toBe(fallback);
    expect(parseRangeDate(42, fallback)).toBe(fallback);
  });

  it('takes a real ISO date', () => {
    const fallback = new Date('2026-01-01T00:00:00Z');
    expect(parseRangeDate('2026-03-04T00:00:00Z', fallback).toISOString()).toBe('2026-03-04T00:00:00.000Z');
  });
});

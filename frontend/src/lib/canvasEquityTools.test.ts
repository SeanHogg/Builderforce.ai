import { describe, expect, it } from 'vitest';
import { capTableFieldsFrom } from './canvasEquityTools';
import type { CapTable } from './founderOpsApi';

const holder = (holderName: string, shares: number, percentFullyDiluted: number): CapTable['holders'][number] => ({
  holderName, shares, percentFullyDiluted,
  shareClassName: 'Common', instrument: 'common', vested: shares,
} as CapTable['holders'][number]);

const table = (holders: CapTable['holders'], poolUnallocated: number): CapTable => ({
  companyRef: 'acme', asOf: '2026-09-01T00:00:00Z', classes: [], holders,
  issued: 900, fullyDiluted: 1_000, poolAuthorized: 100, poolGranted: 100 - poolUnallocated, poolUnallocated,
  poolOverAllocated: false, convertibles: [], convertiblePrincipal: 0, eventCount: 3,
} as CapTable);

/**
 * `capTableFieldsFrom` is the only writer of `holders[].percent`, so it is the place
 * the balance is asserted before the summary and warning are composed — a projection
 * whose percentages do not reach 100 including the pool says so on the card it writes.
 */
describe('capTableFieldsFrom', () => {
  it('writes no warning when holders plus the pool reach 100', () => {
    const fields = capTableFieldsFrom(table([holder('Ada', 600, 60), holder('Bob', 300, 30)], 100));
    expect(fields).not.toHaveProperty('warning');
    expect(String(fields.summary)).not.toContain('do not balance');
  });

  it('says when the percent column does not balance, and points the summary at it', () => {
    const fields = capTableFieldsFrom(table([holder('Ada', 600, 55), holder('Bob', 300, 30)], 100));
    expect(String(fields.warning)).toContain('total 95%');
    expect(String(fields.summary)).toContain('do not balance');
  });
});

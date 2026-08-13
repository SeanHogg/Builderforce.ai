import { describe, expect, it } from 'vitest';
import {
  convertMoney,
  formatMoney,
  formatMoneyField,
  parseMoney,
  percentBalance,
  sumMoney,
  sumRowColumn,
  type FxRates,
} from './canvasMoney';

const FX: FxRates = { base: 'USD', rates: { EUR: 0.9, GBP: 0.8 }, asOf: '2026-08-13T00:00:00.000Z' };

describe('parseMoney', () => {
  it('reads the prose shape the founder specs have been storing', () => {
    const value = parseMoney('$1.2M ARR (2025 estimate)');
    expect(value?.amount).toBe(1_200_000);
    expect(value?.currency).toBe('USD');
    expect(value?.approximate).toBe(true);
    expect(value?.qualifier).toContain('ARR');
    expect(value?.text).toBe('$1.2M ARR (2025 estimate)');
  });

  it('keeps an undisclosed figure undisclosed rather than zero', () => {
    const value = parseMoney('not disclosed');
    expect(value?.disclosed).toBe(false);
    expect(value?.amount).toBeUndefined();
  });

  it('lets a bare range side inherit the written scale', () => {
    const value = parseMoney('~$2–4M');
    expect(value?.low).toBe(2_000_000);
    expect(value?.high).toBe(4_000_000);
    expect(value?.amount).toBe(3_000_000);
    expect(value?.approximate).toBe(true);
  });

  it('does not invent a scale when neither side wrote one', () => {
    const value = parseMoney('1000-2000');
    expect(value?.low).toBe(1_000);
    expect(value?.high).toBe(2_000);
  });

  it('honours a scale written on both sides', () => {
    const value = parseMoney('$500k-1M');
    expect(value?.low).toBe(500_000);
    expect(value?.high).toBe(1_000_000);
  });

  it('prefers an explicit ISO code over a symbol', () => {
    expect(parseMoney('$1,200 CAD')?.currency).toBe('CAD');
    expect(parseMoney('€4.5M')?.currency).toBe('EUR');
  });

  it('takes a number and an already-structured value', () => {
    expect(parseMoney(4200, 'gbp')).toEqual({ amount: 4200, currency: 'GBP' });
    expect(parseMoney({ amount: '900', currency: 'eur' })).toEqual({ amount: 900, currency: 'EUR' });
  });

  it('preserves unreadable text instead of discarding it', () => {
    const value = parseMoney('several million, we think');
    expect(value?.amount).toBeUndefined();
    expect(value?.text).toBe('several million, we think');
  });

  it('returns null only for genuinely empty input', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('   ')).toBeNull();
  });
});

describe('sumMoney', () => {
  it('totals a single-currency set', () => {
    const result = sumMoney(['$1.2M', '$800k', 1_000_000]);
    expect(result.total?.amount).toBe(3_000_000);
    expect(result.total?.currency).toBe('USD');
    expect(result.counted).toBe(3);
    expect(result.skipped).toHaveLength(0);
  });

  it('never silently drops what it could not read', () => {
    const result = sumMoney(['$100', 'not disclosed', 'lots']);
    expect(result.total?.amount).toBe(100);
    expect(result.skipped).toEqual([
      { text: 'not disclosed', reason: 'undisclosed' },
      { text: 'lots', reason: 'unparseable' },
    ]);
  });

  it('refuses to add a euro to a dollar without rates', () => {
    const result = sumMoney(['$100', '$50', '€90']);
    expect(result.total?.amount).toBe(150);
    expect(result.skipped).toEqual([{ text: '€90', reason: 'currency' }]);
    expect(result.currencies).toEqual(['EUR', 'USD']);
  });

  it('converts instead of skipping when rates are supplied', () => {
    const result = sumMoney(['$100', '€90'], { fx: FX });
    expect(result.total?.amount).toBe(200);
    expect(result.total?.approximate).toBe(true);
    expect(result.skipped).toHaveLength(0);
  });

  it('reports nothing rather than zero when there is nothing summable', () => {
    const result = sumMoney(['not disclosed']);
    expect(result.total).toBeUndefined();
    expect(result.counted).toBe(0);
  });
});

describe('convertMoney', () => {
  it('crosses two non-base currencies through the base', () => {
    const value = convertMoney({ amount: 90, currency: 'EUR' }, 'GBP', FX);
    expect(value?.amount).toBeCloseTo(80, 6);
    expect(value?.currency).toBe('GBP');
    expect(value?.approximate).toBe(true);
  });

  it('returns null for a pair the rates do not cover', () => {
    expect(convertMoney({ amount: 10, currency: 'JPY' }, 'USD', FX)).toBeNull();
    expect(convertMoney({ amount: 10, currency: 'EUR' }, 'USD', null)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('compacts a large figure and marks an estimate', () => {
    expect(formatMoney({ amount: 1_200_000, currency: 'USD', approximate: true })).toBe('~$1.2M');
  });

  it('renders an undisclosed figure as what it said', () => {
    expect(formatMoney({ disclosed: false, text: 'not disclosed' })).toBe('not disclosed');
  });

  it('formats straight off a stored prose field', () => {
    expect(formatMoneyField('$1.2M ARR (2025 estimate)')).toBe('~$1.2M');
  });

  it('does not blank a card for an unknown currency code', () => {
    expect(formatMoney({ amount: 12, currency: 'ZZZ' })).toContain('12');
  });
});

describe('sumRowColumn', () => {
  it('totals the column shape every founder rows field has', () => {
    const rows = [{ area: 'Engineering', amount: '$1.2M' }, { area: 'Sales', amount: '$800k' }];
    expect(sumRowColumn(rows, 'amount').total?.amount).toBe(2_000_000);
  });

  it('is empty rather than zero for a non-array', () => {
    expect(sumRowColumn(undefined, 'amount').counted).toBe(0);
  });
});

describe('percentBalance', () => {
  it('makes the cap-table instruction checkable', () => {
    const holders = [{ percent: 60 }, { percent: 30 }, { percent: '10%' }];
    expect(percentBalance(holders, 'percent')).toEqual({ total: 100, balanced: true, counted: 3 });
  });

  it('reports an unbalanced table rather than adjusting it', () => {
    expect(percentBalance([{ percent: 60 }, { percent: 30 }], 'percent').balanced).toBe(false);
  });

  it('does not call an empty table balanced', () => {
    expect(percentBalance([], 'percent').balanced).toBe(false);
  });
});

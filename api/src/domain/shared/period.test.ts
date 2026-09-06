import { describe, expect, it } from 'vitest';
import { currentPeriodMonth, fiscalYearParam, periodParam } from './period';

const NOW = Date.UTC(2026, 8, 6, 12); // 2026-09-06T12:00Z

describe('period', () => {
  it('spells the current UTC month', () => {
    expect(currentPeriodMonth(NOW)).toBe('2026-09');
    expect(currentPeriodMonth(Date.UTC(2026, 0, 1))).toBe('2026-01');
  });

  it('accepts a well-formed period and falls back otherwise', () => {
    expect(periodParam('2025-12', NOW)).toBe('2025-12');
    expect(periodParam('2025-1', NOW)).toBe('2026-09');
    expect(periodParam(undefined, NOW)).toBe('2026-09');
    expect(periodParam(['2025-12'], NOW)).toBe('2026-09');
  });

  it('bounds the fiscal year', () => {
    expect(fiscalYearParam('2024', NOW)).toBe(2024);
    expect(fiscalYearParam('1999', NOW)).toBe(2026);
    expect(fiscalYearParam('abc', NOW)).toBe(2026);
  });
});

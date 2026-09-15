/**
 * The runway report's pivot (PRD 19 B1): six monthly facts become one row per
 * month, the latest of each metric is the headline, and an empty tenant reads
 * as "no data" rather than as a runway of zero — the value that fires every
 * alarm on a board.
 */
import { describe, expect, it } from 'vitest';
import { pivotObserved } from './runwayReport';

const at = (iso: string) => new Date(iso);

describe('pivotObserved', () => {
  it('is unavailable, not zero, when there are no facts', () => {
    const observed = pivotObserved([]);
    expect(observed.available).toBe(false);
    expect(observed.runwayMonths).toBeNull();
    expect(observed.months).toEqual([]);
  });

  it('pivots metrics into one row per month, oldest first, and folds them into cashflow', () => {
    const observed = pivotObserved([
      { metric: 'finance.burn', bucketAt: at('2026-08-01T00:00:00Z'), value: 50_000, computedAt: at('2026-09-01T03:00:00Z') },
      { metric: 'finance.revenue', bucketAt: at('2026-08-01T00:00:00Z'), value: 20_000, computedAt: at('2026-09-01T03:00:00Z') },
      { metric: 'finance.cash', bucketAt: at('2026-08-01T00:00:00Z'), value: 400_000, computedAt: at('2026-09-01T03:00:00Z') },
      { metric: 'finance.burn', bucketAt: at('2026-07-01T00:00:00Z'), value: 45_000, computedAt: at('2026-08-01T03:00:00Z') },
      { metric: 'finance.cash', bucketAt: at('2026-07-01T00:00:00Z'), value: 430_000, computedAt: at('2026-08-01T03:00:00Z') },
    ]);
    expect(observed.months.map((m) => m.month)).toEqual(['2026-07', '2026-08']);
    expect(observed.months[1]).toEqual({ month: '2026-08', burn: 50_000, revenue: 20_000, cash: 400_000, mrr: null });
    expect(observed.cashflow[1]).toEqual({ month: '2026-08', inflows: 20_000, outflows: 50_000, net: -30_000, endingBalance: 400_000 });
  });

  it('takes the newest value of each metric as the headline and the newest computation as as-of', () => {
    const observed = pivotObserved([
      { metric: 'finance.runway_months', bucketAt: at('2026-09-01T00:00:00Z'), value: 13.5, computedAt: at('2026-09-15T03:00:00Z') },
      { metric: 'finance.monthly_burn', bucketAt: at('2026-09-01T00:00:00Z'), value: 30_000, computedAt: at('2026-09-15T03:00:00Z') },
      { metric: 'finance.monthly_burn', bucketAt: at('2026-08-01T00:00:00Z'), value: 28_000, computedAt: at('2026-08-15T03:00:00Z') },
    ]);
    expect(observed.runwayMonths).toBe(13.5);
    expect(observed.monthlyBurn).toBe(30_000);
    expect(observed.asOf).toBe('2026-09-15T03:00:00.000Z');
  });

  it('falls back to gross burn for the headline when no net burn fact exists', () => {
    const observed = pivotObserved([
      { metric: 'finance.burn', bucketAt: at('2026-09-01T00:00:00Z'), value: 42_000, computedAt: null },
    ]);
    expect(observed.monthlyBurn).toBe(42_000);
  });
});

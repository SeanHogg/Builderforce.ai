/**
 * The query capabilities that made "revenue by month by region, with the
 * running total and each month's share" answerable at all.
 *
 * Before these, `groupBy` took ONE column and there was no date bucketing, so a
 * model asked such a question had to author the numbers by hand — which the
 * tool description explicitly forbids it from doing.
 */
import { describe, expect, it } from 'vitest';
import { applyWindows, queryTabular, timeBucket, type TabularSource } from './canvasTabularData';

const SALES: TabularSource = {
  columns: ['closed_at', 'region', 'rep', 'amount'],
  rows: [
    { closed_at: '2026-01-05', region: 'EU', rep: 'ada', amount: 100 },
    { closed_at: '2026-01-22', region: 'EU', rep: 'bo', amount: 300 },
    { closed_at: '2026-01-30', region: 'US', rep: 'cy', amount: 200 },
    { closed_at: '2026-02-11', region: 'EU', rep: 'ada', amount: 400 },
    { closed_at: '2026-02-18', region: 'US', rep: 'cy', amount: 600 },
    { closed_at: '2026-03-02', region: 'US', rep: 'cy', amount: 50 },
  ],
};

describe('timeBucket', () => {
  it('buckets to each calendar grain in a form that sorts chronologically', () => {
    expect(timeBucket('2026-02-18T09:30:00Z', 'day')).toBe('2026-02-18');
    expect(timeBucket('2026-02-18', 'month')).toBe('2026-02');
    expect(timeBucket('2026-02-18', 'quarter')).toBe('2026-Q1');
    expect(timeBucket('2026-11-05', 'quarter')).toBe('2026-Q4');
    expect(timeBucket('2026-02-18', 'year')).toBe('2026');
    expect(timeBucket('2026-01-01', 'week')).toBe('2026-W01');
  });

  it('is UTC, so a transaction cannot land in a different month for a different reader', () => {
    expect(timeBucket('2026-02-01T00:30:00Z', 'month')).toBe('2026-02');
  });

  it('returns empty for something that is not a date rather than inventing one', () => {
    expect(timeBucket('not a date', 'month')).toBe('');
    expect(timeBucket('', 'day')).toBe('');
  });
});

describe('queryTabular — time grain', () => {
  it('groups by a bucketed date column', () => {
    const result = queryTabular(SALES, {
      timeGrain: { column: 'closed_at', grain: 'month', as: 'month' },
      groupBy: 'month',
      aggregate: [{ op: 'sum', column: 'amount' }],
      sort: { column: 'month', direction: 'asc' },
    });
    expect(result.rows.map((row) => row.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(result.rows.map((row) => row.sum_amount)).toEqual([600, 1000, 50]);
  });
});

describe('queryTabular — composite grouping', () => {
  it('returns one row per combination, with each grouping column its own field', () => {
    const result = queryTabular(SALES, {
      timeGrain: { column: 'closed_at', grain: 'month', as: 'month' },
      groupBy: ['month', 'region'],
      aggregate: [{ op: 'sum', column: 'amount' }],
      sort: { column: 'month', direction: 'asc' },
    });
    expect(result.groupColumns).toEqual(['month', 'region']);
    // Jan·EU, Jan·US, Feb·EU, Feb·US, Mar·US — one row per combination that
    // actually occurs, not the full cross product.
    expect(result.rows).toHaveLength(5);
    // Each column is separately addressable — this is what lets the result be
    // re-charted or re-grouped rather than only read as a joined label.
    expect(result.rows[0]).toMatchObject({ month: '2026-01', region: 'EU', sum_amount: 400 });
    expect(result.groups?.[0]?.key).toBe('2026-01 · EU');
  });

  it('caps the composite at four columns rather than exploding the result', () => {
    const result = queryTabular(SALES, { groupBy: ['region', 'rep', 'closed_at', 'amount', 'region'] });
    expect(result.groupColumns).toHaveLength(4);
  });
});

describe('queryTabular — having', () => {
  it('filters the GROUPS, not the rows', () => {
    const result = queryTabular(SALES, {
      groupBy: 'region',
      aggregate: [{ op: 'sum', column: 'amount' }],
      having: [{ column: 'sum_amount', op: 'gt', value: 800 }],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.region).toBe('US');
    expect(result.filteredGroups).toBe(1);
    // The aggregate over ALL matching rows is unchanged — `having` shapes the
    // output, it does not redefine the total.
    expect(result.aggregates?.sum_amount).toBe(1650);
  });
});

describe('applyWindows', () => {
  const rows = [
    { month: '2026-01', amount: 100 },
    { month: '2026-02', amount: 300 },
    { month: '2026-03', amount: 200 },
  ];

  it('computes a running total in the ORDER it is given', () => {
    const { rows: out, columns } = applyWindows(rows, [{ op: 'runningTotal', column: 'amount' }], 'amount');
    expect(columns).toEqual(['runningTotal_amount']);
    expect(out.map((row) => row.runningTotal_amount)).toEqual([100, 400, 600]);
  });

  it('computes share of the whole', () => {
    const { rows: out } = applyWindows(rows, [{ op: 'percentOfTotal', column: 'amount', as: 'share' }], 'amount');
    expect(out.map((row) => row.share)).toEqual([16.6667, 50, 33.3333]);
  });

  it('ranks largest-first, which is what every "top" question means', () => {
    const { rows: out } = applyWindows(rows, [{ op: 'rank', column: 'amount' }], 'amount');
    expect(out.map((row) => row.rank_amount)).toEqual([3, 1, 2]);
  });

  it('leaves period-over-period blank where there is no prior period, rather than reporting zero', () => {
    const { rows: out } = applyWindows(rows, [{ op: 'percentChange', column: 'amount' }], 'amount');
    expect(out[0]!.percentChange_amount).toBe('');
    expect(out[1]!.percentChange_amount).toBe(200);
    expect(out[2]!.percentChange_amount).toBeCloseTo(-33.3333, 3);
  });

  it('restarts per partition', () => {
    const partitioned = [
      { region: 'EU', amount: 100 },
      { region: 'EU', amount: 300 },
      { region: 'US', amount: 200 },
    ];
    const { rows: out } = applyWindows(partitioned, [{ op: 'runningTotal', column: 'amount', partitionBy: 'region' }], 'amount');
    expect(out.map((row) => row.runningTotal_amount)).toEqual([100, 400, 200]);
  });

  it('is a no-op that returns the same array when no windows are requested', () => {
    expect(applyWindows(rows, [], 'amount').rows).toBe(rows);
  });
});

describe('queryTabular — windows over groups', () => {
  it('computes the window over the SORTED groups and before the limit', () => {
    const result = queryTabular(SALES, {
      timeGrain: { column: 'closed_at', grain: 'month', as: 'month' },
      groupBy: 'month',
      aggregate: [{ op: 'sum', column: 'amount' }],
      sort: { column: 'month', direction: 'asc' },
      window: [{ op: 'runningTotal' }, { op: 'percentOfTotal', as: 'share' }],
      limit: 2,
    });
    expect(result.windowColumns).toEqual(['runningTotal_sum_amount', 'share']);
    expect(result.rows.map((row) => row.runningTotal_sum_amount)).toEqual([600, 1600]);
    // The share is of the WHOLE, not of the two rows that survived the limit.
    expect(result.rows[0]!.share).toBeCloseTo(36.3636, 3);
    expect(result.truncated).toBe(true);
  });
});

describe('queryTabular — back-compatibility', () => {
  it('still accepts a single groupBy string and reports the same shape as before', () => {
    const result = queryTabular(SALES, { groupBy: 'region', aggregate: [{ op: 'count' }] });
    expect(result.columns).toEqual(['region', 'count']);
    expect(result.groups?.map((group) => group.key).sort()).toEqual(['EU', 'US']);
  });

  it('still reports unknown columns rather than silently ignoring them', () => {
    expect(queryTabular(SALES, { groupBy: ['region', 'nope'] }).unknownColumns).toEqual(['nope']);
  });
});

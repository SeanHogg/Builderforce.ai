/**
 * The semantic layer: one definition, one number, everywhere.
 *
 * The assertions that matter are the ones about DISAGREEMENT — two tiles built
 * from the same definition must produce the same value, and a "down is good"
 * metric must not report 50% attainment for a halved churn rate.
 */
import { describe, expect, it } from 'vitest';
import {
  computeMetric,
  computeMetricSeries,
  formatMetricValue,
  metricSlug,
  normalizeMetricDefinition,
  normalizeMetricDefinitions,
  readMetricDefinitions,
} from './canvasMetrics';
import { TABULAR_AGGREGATE_OPERATORS, type TabularSource } from './canvasTabularData';

const SUBSCRIPTIONS: TabularSource = {
  columns: ['id', 'plan', 'mrr', 'state', 'started_at'],
  rows: [
    { id: 's1', plan: 'pro', mrr: 100, state: 'active', started_at: '2026-01-15' },
    { id: 's2', plan: 'pro', mrr: 200, state: 'active', started_at: '2026-01-20' },
    { id: 's3', plan: 'team', mrr: 500, state: 'active', started_at: '2026-02-03' },
    { id: 's4', plan: 'pro', mrr: 900, state: 'churned', started_at: '2026-02-10' },
  ],
};

const MRR = {
  name: 'Monthly recurring revenue',
  aggregate: { op: 'sum', column: 'mrr' },
  filter: [{ column: 'state', value: 'active' }],
  unit: 'USD',
  format: 'currency',
  target: 1000,
};

describe('normalizeMetricDefinition', () => {
  it('slugs the name into a stable id that survives a rename of the label', () => {
    expect(normalizeMetricDefinition(MRR)!.id).toBe('monthly_recurring_revenue');
    expect(metricSlug('Win rate %')).toBe('win_rate');
  });

  it('refuses a definition with no name', () => {
    expect(normalizeMetricDefinition({ aggregate: { op: 'sum' } })).toBeNull();
  });

  it('falls back to count for an aggregate the engine does not have', () => {
    expect(normalizeMetricDefinition({ name: 'x', aggregate: { op: 'geometric_mean' } })!.aggregate.op).toBe('count');
  });

  it('accepts every operator the query engine actually supports', () => {
    for (const op of TABULAR_AGGREGATE_OPERATORS) {
      expect(normalizeMetricDefinition({ name: 'x', aggregate: { op, column: 'mrr' } })!.aggregate.op).toBe(op);
    }
  });

  it('de-duplicates a list by id', () => {
    expect(normalizeMetricDefinitions([MRR, { ...MRR, description: 'a rival' }])).toHaveLength(1);
  });
});

describe('computeMetric', () => {
  it('computes over the filtered rows and reports what it counted', () => {
    const value = computeMetric(SUBSCRIPTIONS, normalizeMetricDefinition(MRR)!);
    expect(value.value).toBe(800);
    expect(value.matchedRows).toBe(3);
    expect(value.totalRows).toBe(4);
  });

  it('gives two consumers of ONE definition the same number', () => {
    const definition = normalizeMetricDefinition(MRR)!;
    expect(computeMetric(SUBSCRIPTIONS, definition).value).toBe(computeMetric(SUBSCRIPTIONS, definition).value);
  });

  it('reads attainment the right way round for a "down is good" metric', () => {
    const churn = normalizeMetricDefinition({ name: 'Churn', aggregate: { op: 'count' }, filter: [{ column: 'state', value: 'churned' }], target: 4, direction: 'down' })!;
    const value = computeMetric(SUBSCRIPTIONS, churn);
    expect(value.value).toBe(1);
    // One churn against a ceiling of four is AHEAD, not 25% of target.
    expect(value.attainment).toBe(400);
    expect(value.status).toBe('ahead');
  });

  it('reports behind when an up-metric misses its target', () => {
    expect(computeMetric(SUBSCRIPTIONS, normalizeMetricDefinition(MRR)!).status).toBe('behind');
  });
});

describe('computeMetricSeries', () => {
  it('breaks the metric down by a dimension', () => {
    const series = computeMetricSeries(SUBSCRIPTIONS, normalizeMetricDefinition({ ...MRR, dimension: 'plan' })!)!;
    expect(series.labels).toEqual(['team', 'pro']);
    expect(series.values).toEqual([500, 300]);
  });

  it('breaks the metric down by month, in chronological order', () => {
    const series = computeMetricSeries(SUBSCRIPTIONS, normalizeMetricDefinition({ ...MRR, timeGrain: { column: 'started_at', grain: 'month' } })!)!;
    expect(series.labels).toEqual(['2026-01', '2026-02']);
    expect(series.values).toEqual([300, 500]);
  });

  it('returns null when the definition has no breakdown to chart', () => {
    expect(computeMetricSeries(SUBSCRIPTIONS, normalizeMetricDefinition(MRR)!)).toBeNull();
  });
});

describe('formatMetricValue', () => {
  it('formats currency, percent and plain numbers', () => {
    expect(formatMetricValue(1234.5, { format: 'currency', unit: 'USD', decimals: 2 }, 'en-US')).toContain('1,234.5');
    expect(formatMetricValue(12.3, { format: 'percent', decimals: 1 }, 'en-US')).toBe('12.3%');
    expect(formatMetricValue(90, { format: 'number', unit: 'ms', decimals: 0 }, 'en-US')).toBe('90 ms');
  });

  it('degrades to a plain number rather than blanking the tile on a bad currency code', () => {
    expect(formatMetricValue(5, { format: 'currency', unit: 'NOT_A_CURRENCY', decimals: 0 })).toBe('5 NOT_A_CURRENCY');
  });

  it('formats a duration in human units', () => {
    expect(formatMetricValue(3_725, { format: 'duration' })).toBe('1h 2m');
  });
});

describe('readMetricDefinitions', () => {
  it('reads the single definition an object carries, and any list beside it', () => {
    const definitions = readMetricDefinitions({ metric: MRR, metrics: [{ name: 'Seats', aggregate: { op: 'count' } }] });
    expect(definitions.map((definition) => definition.id)).toEqual(['monthly_recurring_revenue', 'seats']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  boardMetricDefinitions,
  boardMetricReadings,
  boardTabularSources,
  orderMetricReadings,
  summarizeMetricReadings,
} from './boardMetrics';

const rows = [
  { month: '2026-06-01', plan: 'pro', amount: 100, cost: 40 },
  { month: '2026-07-01', plan: 'pro', amount: 120, cost: 40 },
  { month: '2026-08-01', plan: 'team', amount: 150, cost: 60 },
];

const dataset = { id: 'ds', data: { kind: 'dataset', title: 'Billing', columns: ['month', 'plan', 'amount', 'cost'], rows } };
const revenueCard = {
  id: 'm1',
  data: {
    kind: 'metric',
    title: 'Revenue',
    definition: { id: 'revenue', name: 'Revenue', sourceObjectId: 'ds', aggregate: { op: 'sum', column: 'amount' }, target: 500, timeGrain: { column: 'month', grain: 'month' } },
  },
};
const dashboard = {
  id: 'dash',
  data: {
    kind: 'dashboard',
    title: 'Board pack',
    metrics: [
      { id: 'cogs', name: 'COGS', sourceObjectId: 'ds', aggregate: { op: 'sum', column: 'cost' } },
      { id: 'margin', name: 'Gross margin', expression: '(revenue - cogs) / revenue * 100', format: 'percent', target: 50 },
      // A second declaration of an id the metric card already owns is the SAME metric.
      { id: 'revenue', name: 'Revenue (dupe)', aggregate: { op: 'count' } },
      { id: 'orphan', name: 'Orphan', sourceObjectId: 'nowhere', aggregate: { op: 'count' } },
    ],
  },
};

describe('boardMetricDefinitions', () => {
  it('reads a metric card\'s `definition` and every `metrics` list, first declaration winning', () => {
    const ids = boardMetricDefinitions([revenueCard, dashboard, dataset]).map((definition) => definition.id);
    expect(ids).toEqual(['revenue', 'cogs', 'margin', 'orphan']);
  });
});

describe('boardTabularSources', () => {
  it('keys every object that carries rows by its id, and skips the rest', () => {
    const sources = boardTabularSources([dataset, revenueCard]);
    expect([...sources.keys()]).toEqual(['ds']);
    expect(sources.get('ds')!.rows).toHaveLength(3);
  });
});

describe('boardMetricReadings', () => {
  const readings = boardMetricReadings([revenueCard, dashboard, dataset]);
  const byId = new Map(readings.map((reading) => [reading.definition.id, reading]));

  it('evaluates plain and derived metrics as one set', () => {
    expect(byId.get('revenue')!.value.value).toBe(370);
    expect(byId.get('cogs')!.value.value).toBe(140);
    expect(byId.get('margin')!.derived).toBe(true);
    expect(byId.get('margin')!.error).toBeNull();
  });

  it('reports an uncomputable metric by name instead of a zero', () => {
    expect(byId.get('orphan')!.error).toMatch(/no rows/);
  });

  it('carries a trend for a grained metric', () => {
    expect(byId.get('revenue')!.series).toEqual([100, 120, 150]);
  });

  it('summarises and orders behind-target first, errors last', () => {
    const summary = summarizeMetricReadings(readings);
    expect(summary).toMatchObject({ total: 4, errored: 1 });
    const ordered = orderMetricReadings(readings).map((reading) => reading.definition.id);
    expect(ordered[0]).toBe('revenue');
    expect(ordered.at(-1)).toBe('orphan');
  });

  it('is empty on a board with no metrics', () => {
    expect(boardMetricReadings([dataset])).toEqual([]);
  });
});

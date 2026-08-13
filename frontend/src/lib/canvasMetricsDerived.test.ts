/**
 * The half the semantic layer was missing: arithmetic ACROSS metrics.
 *
 * The assertions that matter are the ones about REFUSAL — a missing operand must be
 * named, not defaulted to zero, because a margin computed against a COGS of zero reads
 * as a perfect 100% and is the most dangerous wrong answer this layer can produce.
 */
import { describe, expect, it } from 'vitest';
import {
  computeDerivedMetric,
  computeMetricSet,
  metricDependencies,
  normalizeMetricDefinition,
  parseMetricOperand,
  type MetricDefinition,
} from './canvasMetrics';
import type { TabularSource } from './canvasTabularData';

const BILLING: TabularSource = {
  columns: ['month', 'amount'],
  rows: [
    { month: '2026-01-15', amount: 800 },
    { month: '2026-02-15', amount: 1_000 },
  ],
};
const COST: TabularSource = { columns: ['amount'], rows: [{ amount: 300 }, { amount: 100 }] };

const revenue: MetricDefinition = {
  id: 'revenue', name: 'Revenue', aggregate: { op: 'sum', column: 'amount' },
  timeGrain: { column: 'month', grain: 'month' },
};
const cogs: MetricDefinition = { id: 'cogs', name: 'COGS', aggregate: { op: 'sum', column: 'amount' } };
const margin: MetricDefinition = {
  id: 'gross_margin', name: 'Gross margin', aggregate: { op: 'count' },
  expression: '(revenue - cogs) / revenue * 100', format: 'percent',
};

const registry = new Map([revenue, cogs, margin].map((definition) => [definition.id, definition]));
const sources = new Map([['revenue', BILLING], ['cogs', COST]]);

describe('parseMetricOperand', () => {
  it('splits a period suffix off the id', () => {
    expect(parseMetricOperand('revenue@previous')).toEqual({ id: 'revenue', period: 'previous' });
    expect(parseMetricOperand('revenue')).toEqual({ id: 'revenue', period: 'current' });
    expect(parseMetricOperand('revenue@nonsense')).toEqual({ id: 'revenue', period: 'current' });
  });
});

describe('computeDerivedMetric', () => {
  it('computes the ratio a single aggregate could never express', () => {
    const result = computeDerivedMetric(margin, registry, sources);
    expect(result.error).toBeUndefined();
    // Latest month's revenue is 1000; COGS is ungrained so it is its 400 total.
    // (1000 - 400) / 1000 * 100
    expect(result.value).toBeCloseTo(60, 6);
    expect(result.operands.map((operand) => operand.id).sort()).toEqual(['cogs', 'revenue']);
  });

  it('reads a prior period off the metric own grain', () => {
    const growth: MetricDefinition = {
      id: 'growth', name: 'MoM growth', aggregate: { op: 'count' },
      expression: 'revenue / revenue@previous - 1',
    };
    const result = computeDerivedMetric(growth, new Map([...registry, ['growth', growth]]), sources);
    // Latest month 1000, previous 800.
    expect(result.value).toBeCloseTo(0.25, 6);
  });

  it('names a missing operand instead of treating it as zero', () => {
    const broken: MetricDefinition = { id: 'x', name: 'X', aggregate: { op: 'count' }, expression: 'revenue / churn' };
    const result = computeDerivedMetric(broken, new Map([...registry, ['x', broken]]), sources);
    expect(result.error).toContain('churn');
    expect(result.value).toBe(0);
  });

  it('says so when an operand has no rows rather than reporting a number', () => {
    const result = computeDerivedMetric(margin, registry, new Map([['revenue', BILLING]]));
    expect(result.error).toContain('cogs');
  });

  it('refuses a previous period on a metric with no time grain', () => {
    const definition: MetricDefinition = { id: 'y', name: 'Y', aggregate: { op: 'count' }, expression: 'cogs@previous' };
    const result = computeDerivedMetric(definition, new Map([...registry, ['y', definition]]), sources);
    expect(result.error).toContain('no time grain');
  });

  it('reports a self-reference rather than overflowing the stack', () => {
    const loop: MetricDefinition = { id: 'loop', name: 'Loop', aggregate: { op: 'count' }, expression: 'loop + 1' };
    const result = computeDerivedMetric(loop, new Map([['loop', loop]]), new Map([['loop', COST]]));
    expect(result.error).toContain('itself');
  });

  it('nests one derived metric inside another', () => {
    const doubled: MetricDefinition = {
      id: 'doubled', name: 'Doubled margin', aggregate: { op: 'count' }, expression: 'gross_margin * 2',
    };
    const result = computeDerivedMetric(doubled, new Map([...registry, ['doubled', doubled]]), sources);
    expect(result.value).toBeCloseTo(120, 6);
  });

  it('scores attainment against a target the same way a plain metric does', () => {
    const withTarget: MetricDefinition = { ...margin, target: 50 };
    const result = computeDerivedMetric(withTarget, new Map([...registry, [withTarget.id, withTarget]]), sources);
    expect(result.status).toBe('ahead');
    expect(computeDerivedMetric({ ...margin, target: 90 }, new Map([...registry, [margin.id, { ...margin, target: 90 }]]), sources).status).toBe('behind');
  });

  it('divides by zero as an error, not as Infinity', () => {
    const zero: MetricDefinition = { id: 'z', name: 'Z', aggregate: { op: 'count' }, expression: 'revenue / zero_metric' };
    const zeroMetric: MetricDefinition = { id: 'zero_metric', name: 'Zero', aggregate: { op: 'sum', column: 'missing' } };
    const result = computeDerivedMetric(zero, new Map([['z', zero], ['revenue', revenue], ['zero_metric', zeroMetric]]),
      new Map([['revenue', BILLING], ['zero_metric', COST]]));
    expect(result.error).toContain('zero');
  });
});

describe('normalizeMetricDefinition', () => {
  it('keeps an expression that parses', () => {
    expect(normalizeMetricDefinition({ name: 'M', expression: 'a / b' })?.expression).toBe('a / b');
  });

  it('drops an expression that does not, so it cannot silently shadow the aggregate', () => {
    expect(normalizeMetricDefinition({ name: 'M', expression: 'a / /' })?.expression).toBeUndefined();
  });
});

describe('metricDependencies', () => {
  it('lists the operands so lineage can draw the edge', () => {
    expect(metricDependencies(margin)).toEqual([
      { id: 'revenue', period: 'current' },
      { id: 'cogs', period: 'current' },
    ]);
  });

  it('is empty for a plain aggregate', () => {
    expect(metricDependencies(revenue)).toEqual([]);
  });
});

describe('computeMetricSet', () => {
  it('evaluates plain and derived definitions through one entry point', () => {
    const values = computeMetricSet([revenue, cogs, margin], sources);
    expect(values.map((value) => value.id)).toEqual(['revenue', 'cogs', 'gross_margin']);
    // The KPI form of a grained metric is still its grand total (1800); the same metric
    // used as an EXPRESSION OPERAND reads the latest bucket (1000). That difference is
    // the documented rule in `periodValue`, and this pins both halves of it.
    expect(values[0].value).toBe(1_800);
    expect(values[2].value).toBeCloseTo(60, 6);
  });

  it('reports a source-less metric rather than charting a zero', () => {
    const values = computeMetricSet([revenue], new Map());
    expect((values[0] as { error?: string }).error).toContain('revenue');
  });
});

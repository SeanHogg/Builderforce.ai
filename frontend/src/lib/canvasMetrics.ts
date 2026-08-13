/**
 * The semantic layer — one definition per metric, consumed by every surface.
 *
 * THE PROBLEM THIS CLOSES: a `kpi` object held a literal `value`. Two KPIs both
 * titled "MRR" could disagree, and neither carried the definition that would say
 * which was right. Nothing could recompute either after the data changed, and a
 * chart of "MRR by month" had no relationship to the tile next to it beyond the
 * word in the title.
 *
 * A metric here is a DEFINITION — source, filter, aggregate, dimension, unit,
 * format, target — and a value is what you get by evaluating it against real
 * rows. The KPI card, the chart, the dashboard widget and the report all
 * evaluate the same definition, so they cannot drift, and a definition change
 * moves all of them at once.
 */

import {
  aggregateLabel,
  queryTabular,
  TABULAR_AGGREGATE_OPERATORS,
  TABULAR_TIME_GRAINS,
  type TabularAggregate,
  type TabularAggregateOperator,
  type TabularFilter,
  type TabularSource,
  type TabularTimeGrain,
} from './canvasTabularData';
import { evaluateExpression, expressionReferences, isFormulaError, parseExpression, type FormulaError } from './canvasFormula';

export const METRIC_FORMATS = ['number', 'currency', 'percent', 'duration'] as const;
export type MetricFormat = typeof METRIC_FORMATS[number];

/** Which direction is good. Decides whether a rise is green or red — the single
 *  fact that makes "churn up 12%" read correctly. */
export const METRIC_DIRECTIONS = ['up', 'down'] as const;
export type MetricDirection = typeof METRIC_DIRECTIONS[number];

/**
 * How far back a metric operand reaches.
 *
 * `previous` is the period before the current one at the metric's own grain, and
 * `yearAgo` is twelve months back — the two comparisons every finance report makes and
 * neither of which a single aggregate could express. A period offset is what turns
 * "revenue" into "net revenue retention".
 */
export const METRIC_PERIODS = ['current', 'previous', 'yearAgo'] as const;
export type MetricPeriod = typeof METRIC_PERIODS[number];

export interface MetricDefinition {
  /** Stable slug. Referenced by charts and dashboards, so it must not change
   *  when the display name does. */
  id: string;
  name: string;
  description?: string;
  /** Canvas object id of the dataset/table this metric is computed from. */
  sourceObjectId?: string;
  aggregate: TabularAggregate;
  filter?: TabularFilter[];
  filterMatch?: 'all' | 'any';
  /** Breakdown column for the series form of this metric. */
  dimension?: string;
  /** Time bucket for the series form — "MRR by month" is dimension-free. */
  timeGrain?: { column: string; grain: TabularTimeGrain };
  unit?: string;
  format?: MetricFormat;
  decimals?: number;
  target?: number;
  direction?: MetricDirection;
  /**
   * ARITHMETIC OVER OTHER METRICS, and the half this layer was missing.
   *
   * `computeMetric` evaluates ONE aggregate over ONE source, which covers a count and a
   * sum and nothing a CFO reports: gross margin is `(revenue - cogs) / revenue`, burn
   * multiple is `net_burn / net_new_arr`, net revenue retention is
   * `revenue / revenue@previous`. Every one is a RATIO of metrics, so the layer that
   * promised "define it once so every KPI, chart and report computes the same number"
   * could only ever define the numerator.
   *
   * When `expression` is present it WINS over `aggregate`, and the operands are other
   * metric ids in the same set — optionally with a period suffix, `revenue@previous`.
   * The expression language is `canvasFormula`, the same parser the sheet uses, so
   * precedence and error handling cannot drift between the two surfaces.
   */
  expression?: string;
}

/** `revenue@previous` → `{ id: 'revenue', period: 'previous' }`. */
export function parseMetricOperand(operand: string): { id: string; period: MetricPeriod } {
  const [id, suffix] = operand.split('@');
  const period = (METRIC_PERIODS as readonly string[]).includes(String(suffix)) ? suffix as MetricPeriod : 'current';
  return { id: metricSlug(id), period };
}

export function metricSlug(value: string, fallback = 'metric'): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (slug || fallback).slice(0, 60);
}

export function normalizeMetricDefinition(value: unknown): MetricDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const rawAggregate = (raw.aggregate && typeof raw.aggregate === 'object' ? raw.aggregate : {}) as Record<string, unknown>;
  const op = (TABULAR_AGGREGATE_OPERATORS as readonly string[]).includes(String(rawAggregate.op))
    ? rawAggregate.op as TabularAggregateOperator
    : 'count';
  const column = typeof rawAggregate.column === 'string' ? rawAggregate.column.trim() : '';
  const grain = raw.timeGrain && typeof raw.timeGrain === 'object' ? raw.timeGrain as Record<string, unknown> : null;
  const grainColumn = grain && typeof grain.column === 'string' ? grain.column.trim() : '';
  return {
    id: metricSlug(typeof raw.id === 'string' && raw.id.trim() ? raw.id : name),
    name: name.slice(0, 120),
    ...(typeof raw.description === 'string' && raw.description.trim() ? { description: raw.description.trim().slice(0, 600) } : {}),
    ...(typeof raw.sourceObjectId === 'string' && raw.sourceObjectId ? { sourceObjectId: raw.sourceObjectId } : {}),
    aggregate: { op, ...(column ? { column } : {}), ...(typeof rawAggregate.label === 'string' && rawAggregate.label.trim() ? { label: rawAggregate.label.trim() } : {}) },
    ...(Array.isArray(raw.filter) ? { filter: raw.filter.filter((item): item is TabularFilter => !!item && typeof item === 'object' && typeof (item as TabularFilter).column === 'string').slice(0, 20) } : {}),
    ...(raw.filterMatch === 'any' ? { filterMatch: 'any' as const } : {}),
    ...(typeof raw.dimension === 'string' && raw.dimension.trim() ? { dimension: raw.dimension.trim() } : {}),
    ...(grainColumn && (TABULAR_TIME_GRAINS as readonly string[]).includes(String(grain?.grain))
      ? { timeGrain: { column: grainColumn, grain: grain!.grain as TabularTimeGrain } }
      : {}),
    ...(typeof raw.unit === 'string' && raw.unit.trim() ? { unit: raw.unit.trim().slice(0, 24) } : {}),
    ...((METRIC_FORMATS as readonly string[]).includes(String(raw.format)) ? { format: raw.format as MetricFormat } : {}),
    ...(Number.isFinite(Number(raw.decimals)) && raw.decimals != null ? { decimals: Math.max(0, Math.min(6, Math.floor(Number(raw.decimals)))) } : {}),
    ...(Number.isFinite(Number(raw.target)) && raw.target != null ? { target: Number(raw.target) } : {}),
    ...((METRIC_DIRECTIONS as readonly string[]).includes(String(raw.direction)) ? { direction: raw.direction as MetricDirection } : {}),
    // Only kept when it actually parses. A stored expression that cannot be read would
    // otherwise silently shadow the `aggregate` fallback and leave the tile blank with
    // nothing to explain it — the definition is refused at the door instead.
    ...(typeof raw.expression === 'string' && raw.expression.trim() && !isFormulaError(parseExpression(raw.expression))
      ? { expression: raw.expression.trim().slice(0, 400) }
      : {}),
  };
}

export function normalizeMetricDefinitions(value: unknown): MetricDefinition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const definition = normalizeMetricDefinition(item);
    if (!definition || seen.has(definition.id)) return [];
    seen.add(definition.id);
    return [definition];
  }).slice(0, 40);
}

export interface MetricValue {
  id: string;
  name: string;
  value: number;
  /** Rows the value was computed from — the evidence that it is not invented. */
  matchedRows: number;
  totalRows: number;
  target?: number;
  /** Progress toward target as a percentage, direction-aware. */
  attainment?: number;
  status?: 'ahead' | 'on-track' | 'behind';
  unit?: string;
  format: MetricFormat;
  decimals: number;
}

/** Evaluate ONE definition against real rows. */
export function computeMetric(source: TabularSource, definition: MetricDefinition): MetricValue {
  const result = queryTabular(source, {
    ...(definition.filter?.length ? { filter: definition.filter } : {}),
    ...(definition.filterMatch ? { filterMatch: definition.filterMatch } : {}),
    aggregate: [definition.aggregate],
    limit: 1,
  });
  const value = Object.values(result.aggregates ?? {})[0] ?? 0;
  const format = definition.format ?? 'number';
  const decimals = definition.decimals ?? (format === 'percent' ? 1 : format === 'currency' ? 2 : 0);
  const base: MetricValue = {
    id: definition.id,
    name: definition.name,
    value,
    matchedRows: result.matchedRows,
    totalRows: result.totalRows,
    ...(definition.unit ? { unit: definition.unit } : {}),
    format,
    decimals,
  };
  if (definition.target == null || definition.target === 0) return base;
  // Direction-aware: for a `down` metric, being UNDER target is the win, so
  // attainment inverts rather than reporting 50% for a halved churn rate.
  const attainment = definition.direction === 'down'
    ? (value === 0 ? 200 : (definition.target / value) * 100)
    : (value / definition.target) * 100;
  return {
    ...base,
    target: definition.target,
    attainment: Number(attainment.toFixed(1)),
    status: attainment >= 100 ? 'ahead' : attainment >= 90 ? 'on-track' : 'behind',
  };
}

export interface MetricSeries {
  labels: string[];
  values: number[];
  /** The column the breakdown ran over — the chart's x-axis label. */
  dimension: string;
}

/**
 * The series form of a metric.
 *
 * A time grain wins over a plain dimension when both are set, because "MRR by
 * month by plan" is a composite breakdown and the time axis must lead it.
 */
export function computeMetricSeries(source: TabularSource, definition: MetricDefinition): MetricSeries | null {
  const bucketName = definition.timeGrain ? `${definition.timeGrain.column}_${definition.timeGrain.grain}` : null;
  const groupBy = [bucketName, definition.dimension].filter((column): column is string => !!column);
  if (!groupBy.length) return null;
  // A time series reads chronologically; a categorical breakdown reads
  // largest-first BY THE METRIC — not by row count, which is what the engine's
  // default group sort means and which orders "MRR by plan" by how many
  // subscriptions each plan has rather than by how much money it makes.
  const valueKey = aggregateLabel(definition.aggregate);
  const result = queryTabular(source, {
    ...(definition.filter?.length ? { filter: definition.filter } : {}),
    ...(definition.filterMatch ? { filterMatch: definition.filterMatch } : {}),
    ...(definition.timeGrain ? { timeGrain: { column: definition.timeGrain.column, grain: definition.timeGrain.grain, as: bucketName! } } : {}),
    groupBy,
    aggregate: [definition.aggregate],
    sort: bucketName ? { column: bucketName, direction: 'asc' as const } : { column: valueKey, direction: 'desc' as const },
    limit: 200,
  });
  return {
    labels: (result.groups ?? []).map((group) => String(group.key ?? '')),
    values: (result.groups ?? []).map((group) => Number(group[valueKey] ?? group.count ?? 0)),
    dimension: groupBy.join(' · '),
  };
}

/**
 * Format a metric value for display.
 *
 * `locale` is passed in rather than read from a hook, because this is also
 * called from tool results and from server-rendered surfaces.
 */
export function formatMetricValue(value: number, definition: Pick<MetricDefinition, 'format' | 'decimals' | 'unit'>, locale = 'en'): string {
  const format = definition.format ?? 'number';
  const decimals = definition.decimals ?? (format === 'percent' ? 1 : format === 'currency' ? 2 : 0);
  if (format === 'duration') {
    const seconds = Math.max(0, Math.round(value));
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m ${seconds % 60}s`;
  }
  try {
    if (format === 'currency' && definition.unit) {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: definition.unit.toUpperCase(), maximumFractionDigits: decimals }).format(value);
    }
    const formatted = new Intl.NumberFormat(locale, {
      ...(format === 'percent' ? { style: 'percent' as const, maximumFractionDigits: decimals } : { maximumFractionDigits: decimals }),
    }).format(format === 'percent' ? value / 100 : value);
    return definition.unit && format !== 'percent' ? `${formatted} ${definition.unit}` : formatted;
  } catch {
    // An invalid currency code must not blank the tile.
    return `${value.toFixed(decimals)}${definition.unit ? ` ${definition.unit}` : ''}`;
  }
}

/** Read metric definitions off a canvas object. */
export function readMetricDefinitions(data: Record<string, unknown>): MetricDefinition[] {
  const single = normalizeMetricDefinition(data.metric);
  const many = normalizeMetricDefinitions(data.metrics);
  return single ? [single, ...many.filter((definition) => definition.id !== single.id)] : many;
}

// ── Derived metrics ────────────────────────────────────────────────────────────────

/** A metric operand's value for one period, and the rows behind it. */
interface PeriodValue { value: number; matchedRows: number; totalRows: number }

/**
 * Evaluate ONE operand of an expression, for one period.
 *
 * ── THE RULE, AND WHY IT IS NOT THE SAME AS A PLAIN KPI's ────────────────────────
 * Inside an expression, a GRAINED metric always reads ONE BUCKET: `current` is the
 * latest, `previous` is one back, `yearAgo` is a year of buckets back. A plain KPI of
 * the same definition still reports the grand total, and that difference is deliberate.
 *
 * Reading `current` as the total here was the first implementation and it is wrong in a
 * way that produces a plausible number: `revenue / revenue@previous - 1` would divide
 * cumulative revenue-to-date by a single prior month and report 125% month-over-month
 * growth on a business that grew 25%. Nobody writing that expression means "compare the
 * total to one month" — a period offset only makes sense against a comparable period,
 * so both sides read the same shape.
 *
 * An UNGRAINED metric has no buckets, so `current` is its aggregate and a period offset
 * is refused by name rather than silently answered. "Vs last month" on a metric with no
 * time column is a number with no defensible definition.
 */
function periodValue(
  source: TabularSource,
  definition: MetricDefinition,
  period: MetricPeriod,
): PeriodValue | FormulaError {
  if (!definition.timeGrain) {
    if (period === 'current') {
      const computed = computeMetric(source, definition);
      return { value: computed.value, matchedRows: computed.matchedRows, totalRows: computed.totalRows };
    }
    return { error: 'VALUE', message: `"${definition.id}" has no time grain, so it has no ${period} period` };
  }

  const series = computeMetricSeries(source, definition);
  if (!series || !series.values.length) {
    return { error: 'VALUE', message: `"${definition.id}" produced no series to look back through` };
  }
  const back = period === 'current' ? 0 : period === 'previous' ? 1 : bucketsPerYear(definition.timeGrain.grain);
  const at = series.values.length - 1 - back;
  if (at < 0) {
    return { error: 'VALUE', message: `"${definition.id}" has only ${series.values.length} periods — not enough for ${period}` };
  }
  return { value: series.values[at], matchedRows: 0, totalRows: 0 };
}

/** How many buckets of this grain make a year. Drives the `yearAgo` offset. */
function bucketsPerYear(grain: TabularTimeGrain): number {
  switch (grain) {
    case 'day': return 365;
    case 'week': return 52;
    case 'month': return 12;
    case 'quarter': return 4;
    case 'year': return 1;
    default: return 12;
  }
}

export interface DerivedMetricValue extends MetricValue {
  /** The operands that produced it, so a reviewer can see the working. */
  operands: Array<{ operand: string; id: string; period: MetricPeriod; value: number }>;
  /** Set when the expression could not be evaluated. The tile renders this, not a zero. */
  error?: string;
}

/**
 * Evaluate a definition that carries an `expression`.
 *
 * `sources` maps a metric id to the rows it is computed from, so a ratio may cross two
 * datasets — gross margin whose revenue comes from the billing export and whose COGS
 * comes from the vendor spend sheet is the ordinary case, not the exotic one. A missing
 * operand is reported by name rather than defaulted to zero: a margin computed against a
 * COGS of zero reads as 100% and is the most dangerous possible wrong answer.
 */
export function computeDerivedMetric(
  definition: MetricDefinition,
  registry: ReadonlyMap<string, MetricDefinition>,
  sources: ReadonlyMap<string, TabularSource>,
): DerivedMetricValue {
  const format = definition.format ?? 'number';
  const decimals = definition.decimals ?? (format === 'percent' ? 1 : format === 'currency' ? 2 : 0);
  const operands: DerivedMetricValue['operands'] = [];
  const base = (message?: string): DerivedMetricValue => ({
    id: definition.id,
    name: definition.name,
    value: 0,
    matchedRows: 0,
    totalRows: 0,
    ...(definition.unit ? { unit: definition.unit } : {}),
    format,
    decimals,
    operands,
    ...(message ? { error: message } : {}),
  });

  if (!definition.expression) return base('This metric has no expression');
  const ast = parseExpression(definition.expression);
  if (isFormulaError(ast)) return base(ast.message);

  // Cycle guard. `a = b + 1` and `b = a + 1` is a mistake a model makes readily, and
  // without this it is a stack overflow rather than a message.
  const seen = new Set<string>([definition.id]);
  const resolve = (operandText: string): number | FormulaError => {
    const { id, period } = parseMetricOperand(operandText);
    if (seen.has(id) && !(period !== 'current' && id === definition.id)) {
      return { error: 'CYCLE', message: `"${id}" refers back to itself` };
    }
    const target = registry.get(id);
    if (!target) return { error: 'NAME', message: `No metric named "${id}" on this board` };

    // A derived operand is checked BEFORE a source is demanded: a metric defined purely
    // as arithmetic over others has no rows of its own, and requiring some would make
    // every nested definition report "no rows to compute from" — a true statement about
    // a metric that never needed any.
    if (target.expression) {
      seen.add(id);
      const nested = computeDerivedMetric(target, registry, sources);
      seen.delete(id);
      if (nested.error) return { error: 'VALUE', message: nested.error };
      remember({ operand: operandText, id, period, value: nested.value });
      return nested.value;
    }

    const source = sources.get(id) ?? (target.sourceObjectId ? sources.get(target.sourceObjectId) : undefined);
    if (!source) return { error: 'REF', message: `"${id}" has no rows to compute from` };

    const computed = periodValue(source, target, period);
    if (isFormulaError(computed)) return computed;
    remember({ operand: operandText, id, period, value: computed.value });
    return computed.value;
  };

  /** One entry per distinct operand — `(revenue - cogs) / revenue` shows revenue once. */
  function remember(entry: DerivedMetricValue['operands'][number]): void {
    if (operands.some((existing) => existing.operand === entry.operand)) return;
    operands.push(entry);
  }

  const result = evaluateExpression(ast, { name: resolve });
  if (isFormulaError(result)) return base(result.message);
  const value = typeof result === 'number' ? result : Number(result);
  if (!Number.isFinite(value)) return base('The expression did not produce a number');

  const matchedRows = operands.length;
  const computed: DerivedMetricValue = { ...base(), value, matchedRows, totalRows: matchedRows, operands };
  if (definition.target == null || definition.target === 0) return computed;
  const attainment = definition.direction === 'down'
    ? (value === 0 ? 200 : (definition.target / value) * 100)
    : (value / definition.target) * 100;
  return {
    ...computed,
    target: definition.target,
    attainment: Number(attainment.toFixed(1)),
    status: attainment >= 100 ? 'ahead' : attainment >= 90 ? 'on-track' : 'behind',
  };
}

/** Every metric id an expression depends on, with its period. Drives the lineage edge. */
export function metricDependencies(definition: MetricDefinition): Array<{ id: string; period: MetricPeriod }> {
  if (!definition.expression) return [];
  const ast = parseExpression(definition.expression);
  if (isFormulaError(ast)) return [];
  return expressionReferences(ast).names.map(parseMetricOperand);
}

/**
 * Evaluate a whole set — plain metrics directly, derived ones through their operands.
 *
 * One entry point so a dashboard cannot evaluate half its tiles one way and half the
 * other, which is exactly how two tiles titled "MRR" came to disagree in the first place.
 */
export function computeMetricSet(
  definitions: readonly MetricDefinition[],
  sources: ReadonlyMap<string, TabularSource>,
): Array<MetricValue | DerivedMetricValue> {
  const registry = new Map(definitions.map((definition) => [definition.id, definition]));
  return definitions.map((definition) => {
    if (definition.expression) return computeDerivedMetric(definition, registry, sources);
    const source = sources.get(definition.id) ?? (definition.sourceObjectId ? sources.get(definition.sourceObjectId) : undefined);
    if (!source) {
      const format = definition.format ?? 'number';
      return {
        id: definition.id,
        name: definition.name,
        value: 0,
        matchedRows: 0,
        totalRows: 0,
        format,
        decimals: definition.decimals ?? (format === 'percent' ? 1 : format === 'currency' ? 2 : 0),
        operands: [],
        error: `"${definition.id}" has no rows to compute from`,
      } satisfies DerivedMetricValue;
    }
    return computeMetric(source, definition);
  });
}

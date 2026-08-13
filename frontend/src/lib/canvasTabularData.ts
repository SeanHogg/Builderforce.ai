/**
 * Shared tabular primitives for the Creation Canvas.
 *
 * One engine parses an uploaded data file, profiles its columns, and answers a
 * declarative query over the *full* row set. Brain, the dataset importer, the
 * composer attachment path, and the rendered Table/Chart objects all read from
 * it, so an answer can never be an invented placeholder while real rows are
 * sitting on the canvas.
 *
 * The MATHS lives one module over, in `canvasStatistics`: a median is needed by the
 * aggregate evaluator, the column profiler, the quality checks and the notebook
 * kernel, and a median implemented four times is a median that will eventually
 * disagree with itself.
 */
import { parseCSV } from './importHelpers';
import { correlation, median, mode, percentile, stddev, summarize, variance, zScores, type NumericSummary } from './canvasStatistics';

export type TabularCell = string | number;
export type TabularRow = Record<string, TabularCell>;
export type TabularSource = { columns: string[]; rows: TabularRow[] };

/** Column ceiling for a canvas dataset. Wide operational exports (shipment,
 * CRM, and finance extracts) routinely exceed 24 columns, and silently dropping
 * the column a user asks about produces a confidently wrong analysis. */
export const MAX_TABULAR_COLUMNS = 60;
/** Rows retained on a materialized Table object. Analysis always runs over the
 * complete row set; only the rendered artifact is capped. */
export const MAX_MATERIALIZED_ROWS = 500;

const TABULAR_EXTENSION = /\.(csv|tsv|tab|txt|json|jsonl|ndjson)$/i;
const TABULAR_MIME = /(?:text\/csv|text\/tab-separated-values|application\/csv|application\/json|text\/plain)/i;

export function isTabularFile(fileName: string, mimeType?: string): boolean {
  return TABULAR_EXTENSION.test(fileName.trim()) || (!!mimeType && TABULAR_MIME.test(mimeType));
}

function normalizeCell(value: unknown): TabularCell {
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function fromRecords(records: Array<Record<string, unknown>>): TabularSource {
  const columns: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (key && !columns.includes(key) && columns.length < MAX_TABULAR_COLUMNS) columns.push(key);
    }
  }
  return { columns, rows: records.map((record) => Object.fromEntries(columns.map((column) => [column, normalizeCell(record[column])]))) };
}

/** Parse CSV, TSV, JSON array, or JSONL text into a uniform tabular source. */
export function parseTabularText(fileName: string, text: string): TabularSource {
  const name = fileName.trim().toLowerCase();
  const body = text.replace(/^﻿/, '');
  if (!body.trim()) return { columns: [], rows: [] };
  if (name.endsWith('.json') || name.endsWith('.jsonl') || name.endsWith('.ndjson') || /^\s*[[{]/.test(body)) {
    const records = parseJsonRecords(body);
    if (records) return fromRecords(records);
  }
  const delimiter = name.endsWith('.tsv') || name.endsWith('.tab') ? '\t' : detectDelimiter(body);
  const { headers, rows } = parseCSV(body, delimiter);
  const columns = headers.map((header, index) => header.trim() || `Column ${index + 1}`).filter(Boolean).slice(0, MAX_TABULAR_COLUMNS);
  if (!columns.length) return { columns: [], rows: [] };
  return { columns, rows: rows.map((row) => Object.fromEntries(columns.map((column) => [column, normalizeCell(row[column])]))) };
}

function parseJsonRecords(body: string): Array<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    const records = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown; data?: unknown })?.rows ?? (parsed as { data?: unknown })?.data;
    if (Array.isArray(records)) return records.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
  } catch { /* fall through to JSONL */ }
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const records: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      records.push(parsed as Record<string, unknown>);
    } catch { return null; }
  }
  return records.length ? records : null;
}

function detectDelimiter(body: string): string {
  const header = body.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const counts = [',', '\t', ';', '|'].map((delimiter) => [delimiter, header.split(delimiter).length - 1] as const);
  const best = counts.reduce((winner, candidate) => candidate[1] > winner[1] ? candidate : winner, counts[0]!);
  return best[1] > 0 ? best[0] : ',';
}

/** Numeric reading of a cell, tolerating currency, thousands separators, and
 * percentages so operational exports aggregate without manual cleaning. */
export function toNumber(value: TabularCell | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$£€¥,\s]/g, '').replace(/%$/, '');
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export type TabularColumnType = 'number' | 'boolean' | 'date' | 'text' | 'empty';

export type TabularColumnProfile = {
  name: string;
  type: TabularColumnType;
  filled: number;
  empty: number;
  distinct: number;
  min?: number;
  max?: number;
  sum?: number;
  average?: number;
  /** Share of rows with no value, 0–1. Present on EVERY column, not just numeric
   *  ones: "how much of this column is missing" is the first question asked of any
   *  column and it was previously only derivable by dividing two other fields. */
  nullRate: number;
  /**
   * The five-number summary and the moments, for numeric columns only.
   *
   * This is the field whose absence made "profile this dataset" a prose exercise:
   * with a type, a fill rate and the top six values the model had no median, no
   * spread and no outlier fence, so it described the distribution from the min and
   * the max — which is to say it guessed, in a sentence that read like a result.
   */
  summary?: NumericSummary;
  topValues: Array<{ value: string; count: number }>;
};

/** "0" and "1" are deliberately absent: a 0/1 counter column such as "Count
 * Delivery" must profile as a number so it can be summed and charted. */
const BOOLEAN_VALUES = new Set(['true', 'false', 'yes', 'no', 'y', 'n']);

/** Column-level shape of a dataset: type, fill rate, distinct values, numeric
 * range, and the most common values. This is what orients Brain before it
 * queries, and it is small enough to travel in the canvas snapshot. */
export function profileTabular(source: TabularSource, topValueCount = 6): TabularColumnProfile[] {
  return source.columns.map((name) => {
    const counts = new Map<string, number>();
    const numbers: number[] = [];
    let filled = 0;
    let boolean = 0;
    let date = 0;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const row of source.rows) {
      const raw = row[name];
      const text = typeof raw === 'number' ? String(raw) : (raw ?? '').toString().trim();
      if (!text) continue;
      filled += 1;
      counts.set(text, (counts.get(text) ?? 0) + 1);
      const value = toNumber(raw);
      if (value != null) { numbers.push(value); sum += value; min = Math.min(min, value); max = Math.max(max, value); }
      if (BOOLEAN_VALUES.has(text.toLowerCase())) boolean += 1;
      else if (!Number.isNaN(Date.parse(text)) && /[-/:]/.test(text)) date += 1;
    }
    const numeric = numbers.length;
    const type: TabularColumnType = !filled ? 'empty'
      : numeric === filled ? 'number'
        : boolean === filled ? 'boolean'
          : date >= filled * 0.8 ? 'date'
            : numeric >= filled * 0.8 ? 'number' : 'text';
    // The summary is attached only where it MEANS something. A numeric-looking id
    // column would otherwise report a median customer number, which is a statistic
    // of nothing dressed as a result — so it follows the resolved `type`, not the
    // mere presence of parseable numbers.
    const distribution = type === 'number' && numeric ? summarize(numbers) : null;
    return {
      name,
      type,
      filled,
      empty: source.rows.length - filled,
      distinct: counts.size,
      nullRate: source.rows.length ? Number(((source.rows.length - filled) / source.rows.length).toFixed(6)) : 0,
      ...(numeric ? { min, max, sum: Number(sum.toFixed(6)), average: Number((sum / numeric).toFixed(6)) } : {}),
      ...(distribution ? { summary: distribution } : {}),
      topValues: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topValueCount).map(([value, count]) => ({ value: value.slice(0, 80), count })),
    };
  });
}

export const TABULAR_FILTER_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'notContains', 'empty', 'notEmpty', 'in', 'notIn'] as const;
export type TabularFilterOperator = typeof TABULAR_FILTER_OPERATORS[number];

export type TabularFilter = {
  column: string;
  op?: TabularFilterOperator;
  value?: TabularCell | TabularCell[];
};

export type TabularDerivedColumn = {
  name: string;
  when: TabularFilter[];
  /** How the `when` conditions combine. Defaults to every condition matching. */
  match?: 'all' | 'any';
  then: string;
  otherwise?: string;
};

/**
 * The aggregate vocabulary.
 *
 * The first six shipped alone for a long time, and between them they cannot describe
 * a distribution: no median, no percentile, no spread, no relationship between two
 * columns. The consequence was not a missing feature but a WRONG ANSWER — asked to
 * profile a dataset the model was handed counts and extremes, and then narrated a
 * median and a spread it had never been given. Everything from `median` down closes
 * that, and each one delegates to `canvasStatistics` so the median a chart plots and
 * the median a notebook prints are the same function.
 */
export const TABULAR_AGGREGATE_OPERATORS = [
  'count', 'countDistinct', 'sum', 'avg', 'min', 'max',
  'median', 'percentile', 'stddev', 'variance', 'mode', 'corr',
] as const;
export type TabularAggregateOperator = typeof TABULAR_AGGREGATE_OPERATORS[number];

export type TabularAggregate = {
  op: TabularAggregateOperator;
  column?: string;
  label?: string;
  /** `percentile` only: the fraction to take, 0–1. Defaults to the median. */
  p?: number;
  /** `corr` only: the second column the first is correlated against. */
  against?: string;
};

export type TabularHighlightRule = {
  column: string;
  op?: TabularFilterOperator;
  value?: TabularCell | TabularCell[];
  tone: 'success' | 'warning' | 'danger' | 'info';
};

/** Calendar buckets a date column can be rolled up to. Without these, "revenue
 *  by month" is unaskable and the only way to answer it is for a model to
 *  hand-author the numbers — which is exactly what the query engine exists to
 *  make unnecessary. */
export const TABULAR_TIME_GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type TabularTimeGrain = typeof TABULAR_TIME_GRAINS[number];

export type TabularTimeBucket = {
  column: string;
  grain: TabularTimeGrain;
  /** Output column name. Defaults to `<column>_<grain>`. */
  as?: string;
};

/**
 * Row-relative calculations evaluated over the ORDERED result.
 *
 * These are the questions a grouped count cannot answer: running totals, rank
 * within a segment, share of the whole, and period-over-period movement.
 */
export const TABULAR_WINDOW_OPERATORS = [
  'rowNumber', 'rank', 'denseRank', 'runningTotal', 'percentOfTotal',
  'movingAverage', 'lag', 'delta', 'percentChange',
  // The two that make a result set answer "which of these is unusual" rather than
  // only "which is biggest". `zScore` fences outliers against the column's own
  // spread; `ntile` cuts it into quartiles, deciles or any other equal-count bands,
  // which is how a cohort table is built without hand-typed thresholds.
  'zScore', 'ntile',
] as const;
export type TabularWindowOperator = typeof TABULAR_WINDOW_OPERATORS[number];

export type TabularWindow = {
  op: TabularWindowOperator;
  /** The numeric column the calculation reads. Not needed for `rowNumber`. */
  column?: string;
  /** Restart the calculation per distinct value of these columns. */
  partitionBy?: string | string[];
  /** Output column name. Defaults to a name derived from the operator. */
  as?: string;
  /** Look-back length for `movingAverage`, `lag`, `delta`, `percentChange`. */
  periods?: number;
  /** Band count for `ntile` — 4 for quartiles, 10 for deciles. Defaults to 4. */
  buckets?: number;
};

export type TabularQuery = {
  select?: string[];
  filter?: TabularFilter[];
  filterMatch?: 'all' | 'any';
  derive?: TabularDerivedColumn[];
  /** Bucket a date column before filtering or grouping. The bucket is a real
   *  column, so it can be grouped by, filtered on, and sorted like any other. */
  timeGrain?: TabularTimeBucket;
  /** One column, or several for a composite breakdown ("by month by region"). */
  groupBy?: string | string[];
  aggregate?: TabularAggregate[];
  /** Conditions applied to the GROUPED rows, after aggregation. */
  having?: TabularFilter[];
  havingMatch?: 'all' | 'any';
  sort?: { column: string; direction?: 'asc' | 'desc' };
  /** Row-relative calculations, evaluated after sorting and before limiting. */
  window?: TabularWindow[];
  limit?: number;
};

export type TabularQueryResult = {
  columns: string[];
  rows: TabularRow[];
  totalRows: number;
  matchedRows: number;
  returnedRows: number;
  truncated: boolean;
  groups?: Array<{ key: string; count: number } & Record<string, TabularCell>>;
  /** `null` where the statistic is undefined on the matched rows — see
   *  `computeAggregate`. A consumer that needs a number coalesces at the edge. */
  aggregates?: Record<string, number | null>;
  unknownColumns: string[];
  /** The grouping columns actually applied, in order. */
  groupColumns?: string[];
  /** Columns added by {@link TabularQuery.window}. */
  windowColumns?: string[];
  /** Group rows removed by `having`. */
  filteredGroups?: number;
};

function cellText(value: TabularCell | undefined): string {
  return typeof value === 'number' ? String(value) : (value ?? '').toString();
}

function toList(value: TabularFilter['value']): string[] {
  if (Array.isArray(value)) return value.map((item) => cellText(item).trim().toLowerCase());
  return cellText(value).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/** Evaluate one declarative condition. Comparisons are numeric when both sides
 * read as numbers and case-insensitive text otherwise. */
export function matchesFilter(row: TabularRow, filter: TabularFilter): boolean {
  const raw = row[filter.column];
  const text = cellText(raw).trim();
  const op = filter.op ?? 'eq';
  if (op === 'empty') return !text;
  if (op === 'notEmpty') return !!text;
  if (op === 'in') return toList(filter.value).includes(text.toLowerCase());
  if (op === 'notIn') return !toList(filter.value).includes(text.toLowerCase());
  const expectedText = cellText(Array.isArray(filter.value) ? filter.value[0] : filter.value).trim();
  if (op === 'contains') return text.toLowerCase().includes(expectedText.toLowerCase());
  if (op === 'notContains') return !text.toLowerCase().includes(expectedText.toLowerCase());
  const left = toNumber(raw);
  const right = toNumber(expectedText);
  if (left != null && right != null) {
    if (op === 'eq') return left === right;
    if (op === 'ne') return left !== right;
    if (op === 'gt') return left > right;
    if (op === 'gte') return left >= right;
    if (op === 'lt') return left < right;
    return left <= right;
  }
  const a = text.toLowerCase();
  const b = expectedText.toLowerCase();
  if (op === 'eq') return a === b;
  if (op === 'ne') return a !== b;
  if (op === 'gt') return a > b;
  if (op === 'gte') return a >= b;
  if (op === 'lt') return a < b;
  return a <= b;
}

function matchesAll(row: TabularRow, filters: TabularFilter[], mode: 'all' | 'any'): boolean {
  if (!filters.length) return true;
  return mode === 'any' ? filters.some((filter) => matchesFilter(row, filter)) : filters.every((filter) => matchesFilter(row, filter));
}

/**
 * The output column name for one aggregate.
 *
 * Exported because a caller that wants to SORT by its own aggregate has to be
 * able to name it — `computeMetricSeries` re-deriving this string by hand is how
 * a categorical breakdown ends up ordered by row count instead of by value.
 */
export function aggregateLabel(aggregate: TabularAggregate): string {
  if (aggregate.label?.trim()) return aggregate.label.trim();
  if (aggregate.op === 'count') return 'count';
  // A percentile names its fraction, because `percentile_latency` appearing twice in
  // one result for p50 and p95 would be a silently overwritten column.
  if (aggregate.op === 'percentile') return `p${Math.round(Math.min(1, Math.max(0, aggregate.p ?? 0.5)) * 100)}_${aggregate.column ?? 'value'}`;
  if (aggregate.op === 'corr') return `corr_${aggregate.column ?? 'value'}_${aggregate.against ?? 'value'}`;
  return `${aggregate.op}_${aggregate.column ?? 'value'}`;
}

/**
 * Render an aggregate for display, where `null` means UNDEFINED and not zero.
 *
 * One helper rather than a `?? 0` at each call site, because the coalescing default
 * is what turns "this group had one observation so it has no standard deviation"
 * into a card reading "0" — a statement about the data that the data never made.
 */
export function formatAggregateValue(value: number | null | undefined): string {
  return value == null ? '—' : value.toLocaleString();
}

/**
 * Evaluate one aggregate over a row set.
 *
 * `null` means "not defined on this data" and is deliberately distinct from 0: a
 * standard deviation of one observation, a correlation against a constant column and
 * a median of nothing are all undefined, and returning 0 for them is how an empty
 * group comes to render as a confident reading. Callers that need a number for a
 * chart axis coalesce at the edge, where the substitution is visible.
 */
function computeAggregate(rows: TabularRow[], aggregate: TabularAggregate): number | null {
  if (aggregate.op === 'count') return rows.length;
  const column = aggregate.column;
  if (!column) return rows.length;
  if (aggregate.op === 'countDistinct') return new Set(rows.map((row) => cellText(row[column]).trim().toLowerCase()).filter(Boolean)).size;
  if (aggregate.op === 'corr') {
    const against = aggregate.against;
    if (!against) return null;
    // Pairwise-complete: a row missing EITHER column cannot contribute to a pair,
    // and dropping the columns independently would correlate misaligned values.
    const pairs = rows.flatMap((row) => {
      const x = toNumber(row[column]);
      const y = toNumber(row[against]);
      return x == null || y == null ? [] : [[x, y] as const];
    });
    return correlation(pairs.map(([x]) => x), pairs.map(([, y]) => y));
  }
  const values = rows.map((row) => toNumber(row[column])).filter((value): value is number => value != null);
  if (!values.length) return aggregate.op === 'sum' ? 0 : null;
  switch (aggregate.op) {
    case 'sum': return Number(values.reduce((total, value) => total + value, 0).toFixed(6));
    case 'avg': return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(6));
    case 'min': return Math.min(...values);
    case 'max': return Math.max(...values);
    case 'median': return median(values);
    case 'percentile': return percentile(values, aggregate.p ?? 0.5);
    case 'stddev': return stddev(values);
    case 'variance': return variance(values);
    case 'mode': return mode(values);
    default: return null;
  }
}

/** Run a declarative query over every row of a dataset. Derived columns are
 * applied before filtering and grouping so a computed status (for example
 * "Success" vs "Failure") can be filtered, grouped, and charted like any
 * imported column. */
export function queryTabular(source: TabularSource, query: TabularQuery = {}): TabularQueryResult {
  const derive = (query.derive ?? []).filter((item) => item?.name?.trim() && Array.isArray(item.when));
  const derivedNames = derive.map((item) => item.name.trim());

  // A time bucket is a derived column like any other, computed FIRST so it can
  // be filtered, grouped, and sorted exactly the way an authored column can.
  const bucket = query.timeGrain?.column && (TABULAR_TIME_GRAINS as readonly string[]).includes(String(query.timeGrain.grain))
    ? { column: query.timeGrain.column, grain: query.timeGrain.grain, name: (query.timeGrain.as ?? `${query.timeGrain.column}_${query.timeGrain.grain}`).trim() }
    : null;
  const bucketName = bucket && source.columns.includes(bucket.column) ? bucket.name : null;

  const available = new Set([...source.columns, ...derivedNames, ...(bucketName ? [bucketName] : [])]);
  const derived: TabularRow[] = source.rows.map((row) => {
    if (!derive.length && !bucketName) return row;
    const next: TabularRow = { ...row };
    if (bucketName && bucket) next[bucketName] = timeBucket(next[bucket.column], bucket.grain);
    for (const rule of derive) {
      next[rule.name.trim()] = matchesAll(next, rule.when, rule.match ?? 'all') ? rule.then : (rule.otherwise ?? '');
    }
    return next;
  });

  const groupColumns = (Array.isArray(query.groupBy) ? query.groupBy : query.groupBy ? [query.groupBy] : [])
    .map((column) => String(column))
    .filter((column, index, list) => column && list.indexOf(column) === index)
    .slice(0, 4);
  const windows = (query.window ?? []).filter((item) => item?.op && (TABULAR_WINDOW_OPERATORS as readonly string[]).includes(String(item.op))).slice(0, 6);

  const requested = [
    ...(query.select ?? []),
    ...(query.filter ?? []).map((filter) => filter.column),
    ...groupColumns,
    ...(query.aggregate ?? []).flatMap((aggregate) => aggregate.column ? [aggregate.column] : []),
    ...(query.sort ? [query.sort.column] : []),
    ...derive.flatMap((rule) => rule.when.map((filter) => filter.column)),
    ...(bucket && !bucketName ? [bucket.column] : []),
  ];
  const unknownColumns = [...new Set(requested.filter((column) => column && !available.has(column)))];

  const filters = (query.filter ?? []).filter((filter) => filter?.column && available.has(filter.column));
  const matched = derived.filter((row) => matchesAll(row, filters, query.filterMatch ?? 'all'));

  const aggregates = (query.aggregate ?? []).filter((aggregate) => aggregate?.op);
  const grouping = groupColumns.filter((column) => available.has(column));

  if (grouping.length) {
    const buckets = new Map<string, { values: string[]; rows: TabularRow[] }>();
    for (const row of matched) {
      const values = grouping.map((column) => cellText(row[column]).trim() || '(blank)');
      const key = values.join(' · ');
      const entry = buckets.get(key);
      if (entry) entry.rows.push(row); else buckets.set(key, { values, rows: [row] });
    }
    const specs = aggregates.length ? aggregates : [{ op: 'count' as const }];
    const aggregateNames = specs.map(aggregateLabel);
    let groups = [...buckets.entries()].map(([key, entry]) => ({
      key,
      count: entry.rows.length,
      // Every grouping column is its own field, so a composite breakdown can be
      // charted, filtered and re-grouped rather than only read as a joined label.
      ...Object.fromEntries(grouping.map((column, index) => [column, entry.values[index] ?? ''])),
      ...Object.fromEntries(specs.map((aggregate) => [aggregateLabel(aggregate), computeAggregate(entry.rows, aggregate)])),
    })) as Array<{ key: string; count: number } & Record<string, TabularCell>>;

    const havingBefore = groups.length;
    const having = (query.having ?? []).filter((filter) => filter?.column);
    if (having.length) groups = groups.filter((group) => matchesAll(group as TabularRow, having, query.havingMatch ?? 'all'));
    const filteredGroups = havingBefore - groups.length;

    const sortColumn = query.sort?.column;
    const direction = query.sort?.direction === 'asc' ? 1 : -1;
    groups = groups.sort((a, b) => {
      const left = sortColumn && sortColumn in a ? a[sortColumn] : a.count;
      const right = sortColumn && sortColumn in b ? b[sortColumn] : b.count;
      const numericLeft = toNumber(left as TabularCell);
      const numericRight = toNumber(right as TabularCell);
      if (numericLeft != null && numericRight != null) return (numericLeft - numericRight) * direction;
      return cellText(left as TabularCell).localeCompare(cellText(right as TabularCell)) * direction;
    });

    // Windows run over the SORTED groups — a running total down an unsorted list
    // is a different, wrong number — and before the limit, so "top 10" still
    // shows each row's true share of the whole.
    const windowed = applyWindows(groups as unknown as TabularRow[], windows, aggregateNames[0] ?? 'count');
    const limit = Math.max(1, Math.min(Number(query.limit) || 50, 500));
    const columns = [...grouping, ...aggregateNames, ...windowed.columns];
    const visible = windowed.rows.slice(0, limit);
    return {
      columns,
      rows: visible.map((group) => Object.fromEntries(columns.map((column) => [column, (group as TabularRow)[column] ?? ''])) as TabularRow),
      totalRows: source.rows.length,
      matchedRows: matched.length,
      returnedRows: visible.length,
      truncated: windowed.rows.length > limit,
      groups: visible as unknown as Array<{ key: string; count: number } & Record<string, TabularCell>>,
      aggregates: Object.fromEntries(specs.map((aggregate) => [aggregateLabel(aggregate), computeAggregate(matched, aggregate)])),
      unknownColumns,
      groupColumns: grouping,
      ...(windowed.columns.length ? { windowColumns: windowed.columns } : {}),
      ...(filteredGroups ? { filteredGroups } : {}),
    };
  }

  const selected = (query.select ?? []).filter((column) => available.has(column));
  const baseColumns = selected.length ? selected : [...source.columns, ...derivedNames, ...(bucketName ? [bucketName] : [])];
  let rows = matched;
  if (query.sort?.column && available.has(query.sort.column)) {
    const column = query.sort.column;
    const direction = query.sort.direction === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const left = toNumber(a[column]);
      const right = toNumber(b[column]);
      if (left != null && right != null) return (left - right) * direction;
      return cellText(a[column]).localeCompare(cellText(b[column])) * direction;
    });
  }
  const windowed = applyWindows(rows, windows, query.sort?.column ?? '');
  const columns = [...baseColumns, ...windowed.columns];
  const limit = Math.max(1, Math.min(Number(query.limit) || MAX_MATERIALIZED_ROWS, MAX_MATERIALIZED_ROWS));
  return {
    columns,
    rows: windowed.rows.slice(0, limit).map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ''])) as TabularRow),
    totalRows: source.rows.length,
    matchedRows: matched.length,
    returnedRows: Math.min(windowed.rows.length, limit),
    truncated: windowed.rows.length > limit,
    ...(aggregates.length ? { aggregates: Object.fromEntries(aggregates.map((aggregate) => [aggregateLabel(aggregate), computeAggregate(matched, aggregate)])) } : {}),
    unknownColumns,
    ...(windowed.columns.length ? { windowColumns: windowed.columns } : {}),
  };
}

/**
 * Bucket a date cell to a calendar grain.
 *
 * Buckets are ISO-ish strings that sort lexicographically in chronological
 * order, so a month series needs no separate sort key and a chart's x-axis is
 * correct by construction. UTC throughout: a report must not shift a
 * transaction into a different month because of the reader's timezone.
 */
export function timeBucket(value: TabularCell | undefined, grain: TabularTimeGrain): string {
  const text = cellText(value).trim();
  if (!text) return '';
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return '';
  const date = new Date(parsed);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (grain) {
    case 'year': return String(year);
    case 'quarter': return `${year}-Q${Math.floor(month / 3) + 1}`;
    case 'month': return `${year}-${pad(month + 1)}`;
    case 'week': {
      // ISO-8601 week: Thursday of the current week decides the year.
      const thursday = new Date(Date.UTC(year, month, date.getUTCDate()));
      thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
      const start = Date.UTC(thursday.getUTCFullYear(), 0, 1);
      const week = Math.ceil(((thursday.getTime() - start) / 86_400_000 + 1) / 7);
      return `${thursday.getUTCFullYear()}-W${pad(week)}`;
    }
    default: return `${year}-${pad(month + 1)}-${pad(date.getUTCDate())}`;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function windowColumnName(window: TabularWindow, fallbackColumn: string): string {
  if (window.as?.trim()) return window.as.trim().slice(0, 60);
  const target = window.column?.trim() || fallbackColumn;
  return window.op === 'rowNumber' ? 'rowNumber' : target ? `${window.op}_${target}` : window.op;
}

/**
 * Evaluate row-relative calculations over an ordered row set.
 *
 * Applied to grouped rows or detail rows identically — a running total over
 * months and a running total over transactions are the same operation, so there
 * is one implementation rather than one per call site.
 */
export function applyWindows(
  rows: readonly TabularRow[],
  windows: readonly TabularWindow[],
  fallbackColumn: string,
): { rows: TabularRow[]; columns: string[] } {
  if (!windows.length) return { rows: rows as TabularRow[], columns: [] };
  const next = rows.map((row) => ({ ...row }));
  const columns: string[] = [];

  for (const window of windows) {
    const name = windowColumnName(window, fallbackColumn);
    if (columns.includes(name)) continue;
    const valueColumn = window.column?.trim() || fallbackColumn;
    const partitionBy = (Array.isArray(window.partitionBy) ? window.partitionBy : window.partitionBy ? [window.partitionBy] : []).filter(Boolean);
    const periods = Math.max(1, Math.min(Math.floor(Number(window.periods) || (window.op === 'movingAverage' ? 3 : 1)), 60));

    const partitions = new Map<string, number[]>();
    next.forEach((row, index) => {
      const key = partitionBy.map((column) => cellText(row[column])).join(' · ');
      const bucket = partitions.get(key);
      if (bucket) bucket.push(index); else partitions.set(key, [index]);
    });

    for (const indices of partitions.values()) {
      const values = indices.map((index) => toNumber(next[index]?.[valueColumn]) ?? 0);
      const total = values.reduce((sum, value) => sum + value, 0);
      // Rank is by DESCENDING value — "rank 1" means largest, which is what
      // every "top performers" question means by it.
      const ordered = [...values].map((value, position) => ({ value, position })).sort((a, b) => b.value - a.value);
      const rankByPosition = new Map<number, number>();
      const denseByPosition = new Map<number, number>();
      let dense = 0;
      let previous: number | null = null;
      ordered.forEach((entry, index) => {
        if (previous === null || entry.value !== previous) { dense += 1; previous = entry.value; }
        denseByPosition.set(entry.position, dense);
        rankByPosition.set(entry.position, index + 1);
      });

      // Both of the distribution-relative operators need the partition seen WHOLE
      // before any row in it can be written, which is why they are computed here
      // rather than inside the per-row switch below.
      const scores = window.op === 'zScore' ? zScores(values) : null;
      const bands = window.op === 'ntile' ? ntileBands(values, window.buckets) : null;

      let running = 0;
      indices.forEach((rowIndex, position) => {
        const value = values[position] ?? 0;
        running += value;
        const target = next[rowIndex];
        if (!target) return;
        const previousValue = position >= periods ? values[position - periods] ?? null : null;
        switch (window.op) {
          case 'zScore': target[name] = scores?.[position] ?? 0; break;
          case 'ntile': target[name] = bands?.[position] ?? 1; break;
          case 'rowNumber': target[name] = position + 1; break;
          case 'rank': target[name] = rankByPosition.get(position) ?? position + 1; break;
          case 'denseRank': target[name] = denseByPosition.get(position) ?? position + 1; break;
          case 'runningTotal': target[name] = round(running); break;
          case 'percentOfTotal': target[name] = total ? round(value / total * 100) : 0; break;
          case 'movingAverage': {
            const start = Math.max(0, position - periods + 1);
            const slice = values.slice(start, position + 1);
            target[name] = slice.length ? round(slice.reduce((sum, entry) => sum + entry, 0) / slice.length) : 0;
            break;
          }
          case 'lag': target[name] = previousValue == null ? '' : round(previousValue); break;
          case 'delta': target[name] = previousValue == null ? '' : round(value - previousValue); break;
          case 'percentChange': target[name] = previousValue == null || previousValue === 0 ? '' : round((value - previousValue) / Math.abs(previousValue) * 100); break;
          default: break;
        }
      });
    }
    columns.push(name);
  }

  return { rows: next, columns };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Equal-COUNT bands, 1 = smallest. Quartiles by default.
 *
 * Ranked ascending and cut by position rather than by value, which is what makes
 * this different from binning: ten deciles of a skewed column each hold a tenth of
 * the rows, where ten equal-WIDTH bins would put nine tenths of them in the first.
 * Ties can therefore straddle a boundary — the standard SQL `NTILE` behaviour, and
 * the reason a cohort table built this way always has balanced cohorts.
 */
function ntileBands(values: readonly number[], buckets?: number): number[] {
  const bands = Math.max(2, Math.min(Math.floor(Number(buckets) || 4), 100));
  if (!values.length) return [];
  const order = values.map((value, position) => ({ value, position })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length).fill(1);
  order.forEach((entry, rank) => {
    result[entry.position] = Math.min(bands, Math.floor(rank * bands / order.length) + 1);
  });
  return result;
}

/** Resolve the tone a Table row should render with, first matching rule wins. */
export function highlightToneFor(row: TabularRow, rules: TabularHighlightRule[]): TabularHighlightRule['tone'] | null {
  for (const rule of rules) {
    if (!rule?.column || !rule.tone) continue;
    if (matchesFilter(row, { column: rule.column, op: rule.op ?? 'eq', value: rule.value })) return rule.tone;
  }
  return null;
}

export type WorkbookSheetSource = TabularSource & { name: string };

/**
 * The tabs an imported workbook carries.
 *
 * A dropped `.xlsx` keeps every sheet on one object so switching tabs is a card
 * interaction rather than a re-import; this is the one reader of that shape, so
 * the card, the inspector, and Brain agree on which sheets exist.
 */
export function workbookSheets(data: Record<string, unknown>): WorkbookSheetSource[] {
  if (!Array.isArray(data.sheets)) return [];
  return data.sheets.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const sheet = value as Record<string, unknown>;
    const name = typeof sheet.name === 'string' ? sheet.name.trim() : '';
    if (!name) return [];
    const source = tabularFromObject(sheet);
    return source.columns.length ? [{ name, ...source }] : [];
  });
}

/** Read any canvas object that carries tabular data into the shared shape. */
export function tabularFromObject(data: Record<string, unknown>): TabularSource {
  const rawRows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.sampleRows) ? data.sampleRows : [];
  const declared = Array.isArray(data.columns)
    ? data.columns.map((column) => typeof column === 'string' ? column : String((column as { name?: unknown; key?: unknown })?.name ?? (column as { key?: unknown })?.key ?? '')).filter(Boolean)
    : [];
  const rows: TabularRow[] = rawRows.flatMap((value) => {
    if (Array.isArray(value)) return [Object.fromEntries(value.map((cell, index) => [declared[index] ?? `Column ${index + 1}`, normalizeCell(cell)]))];
    if (!value || typeof value !== 'object') return [];
    return [Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, cell]) => [key, normalizeCell(cell)]))];
  });
  const columns = declared.length ? declared : [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, MAX_TABULAR_COLUMNS);
  return { columns, rows };
}

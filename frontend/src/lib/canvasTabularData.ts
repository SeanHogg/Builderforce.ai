/**
 * Shared tabular primitives for the Creation Canvas.
 *
 * One engine parses an uploaded data file, profiles its columns, and answers a
 * declarative query over the *full* row set. Brain, the dataset importer, the
 * composer attachment path, and the rendered Table/Chart objects all read from
 * it, so an answer can never be an invented placeholder while real rows are
 * sitting on the canvas.
 */
import { parseCSV } from './importHelpers';

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
    let filled = 0;
    let numeric = 0;
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
      if (value != null) { numeric += 1; sum += value; min = Math.min(min, value); max = Math.max(max, value); }
      if (BOOLEAN_VALUES.has(text.toLowerCase())) boolean += 1;
      else if (!Number.isNaN(Date.parse(text)) && /[-/:]/.test(text)) date += 1;
    }
    const type: TabularColumnType = !filled ? 'empty'
      : numeric === filled ? 'number'
        : boolean === filled ? 'boolean'
          : date >= filled * 0.8 ? 'date'
            : numeric >= filled * 0.8 ? 'number' : 'text';
    return {
      name,
      type,
      filled,
      empty: source.rows.length - filled,
      distinct: counts.size,
      ...(numeric ? { min, max, sum: Number(sum.toFixed(6)), average: Number((sum / numeric).toFixed(6)) } : {}),
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

export const TABULAR_AGGREGATE_OPERATORS = ['count', 'countDistinct', 'sum', 'avg', 'min', 'max'] as const;
export type TabularAggregateOperator = typeof TABULAR_AGGREGATE_OPERATORS[number];

export type TabularAggregate = { op: TabularAggregateOperator; column?: string; label?: string };

export type TabularHighlightRule = {
  column: string;
  op?: TabularFilterOperator;
  value?: TabularCell | TabularCell[];
  tone: 'success' | 'warning' | 'danger' | 'info';
};

export type TabularQuery = {
  select?: string[];
  filter?: TabularFilter[];
  filterMatch?: 'all' | 'any';
  derive?: TabularDerivedColumn[];
  groupBy?: string;
  aggregate?: TabularAggregate[];
  sort?: { column: string; direction?: 'asc' | 'desc' };
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
  aggregates?: Record<string, number>;
  unknownColumns: string[];
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

function aggregateLabel(aggregate: TabularAggregate): string {
  if (aggregate.label?.trim()) return aggregate.label.trim();
  return aggregate.op === 'count' ? 'count' : `${aggregate.op}_${aggregate.column ?? 'value'}`;
}

function computeAggregate(rows: TabularRow[], aggregate: TabularAggregate): number {
  if (aggregate.op === 'count') return rows.length;
  const column = aggregate.column;
  if (!column) return rows.length;
  if (aggregate.op === 'countDistinct') return new Set(rows.map((row) => cellText(row[column]).trim().toLowerCase()).filter(Boolean)).size;
  const values = rows.map((row) => toNumber(row[column])).filter((value): value is number => value != null);
  if (!values.length) return 0;
  if (aggregate.op === 'sum') return Number(values.reduce((total, value) => total + value, 0).toFixed(6));
  if (aggregate.op === 'avg') return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(6));
  return aggregate.op === 'min' ? Math.min(...values) : Math.max(...values);
}

/** Run a declarative query over every row of a dataset. Derived columns are
 * applied before filtering and grouping so a computed status (for example
 * "Success" vs "Failure") can be filtered, grouped, and charted like any
 * imported column. */
export function queryTabular(source: TabularSource, query: TabularQuery = {}): TabularQueryResult {
  const derive = (query.derive ?? []).filter((item) => item?.name?.trim() && Array.isArray(item.when));
  const derivedNames = derive.map((item) => item.name.trim());
  const available = new Set([...source.columns, ...derivedNames]);
  const derived: TabularRow[] = source.rows.map((row) => {
    if (!derive.length) return row;
    const next: TabularRow = { ...row };
    for (const rule of derive) {
      next[rule.name.trim()] = matchesAll(next, rule.when, rule.match ?? 'all') ? rule.then : (rule.otherwise ?? '');
    }
    return next;
  });

  const requested = [
    ...(query.select ?? []),
    ...(query.filter ?? []).map((filter) => filter.column),
    ...(query.groupBy ? [query.groupBy] : []),
    ...(query.aggregate ?? []).flatMap((aggregate) => aggregate.column ? [aggregate.column] : []),
    ...(query.sort ? [query.sort.column] : []),
    ...derive.flatMap((rule) => rule.when.map((filter) => filter.column)),
  ];
  const unknownColumns = [...new Set(requested.filter((column) => column && !available.has(column)))];

  const filters = (query.filter ?? []).filter((filter) => filter?.column && available.has(filter.column));
  const matched = derived.filter((row) => matchesAll(row, filters, query.filterMatch ?? 'all'));

  const aggregates = (query.aggregate ?? []).filter((aggregate) => aggregate?.op);
  const groupBy = query.groupBy && available.has(query.groupBy) ? query.groupBy : undefined;

  if (groupBy) {
    const buckets = new Map<string, TabularRow[]>();
    for (const row of matched) {
      const key = cellText(row[groupBy]).trim() || '(blank)';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(row); else buckets.set(key, [row]);
    }
    const specs = aggregates.length ? aggregates : [{ op: 'count' as const }];
    let groups = [...buckets.entries()].map(([key, rows]) => ({
      key,
      count: rows.length,
      ...Object.fromEntries(specs.map((aggregate) => [aggregateLabel(aggregate), computeAggregate(rows, aggregate)])),
    }));
    const sortColumn = query.sort?.column;
    const direction = query.sort?.direction === 'asc' ? 1 : -1;
    groups = groups.sort((a, b) => {
      const left = sortColumn && sortColumn in a ? a[sortColumn as keyof typeof a] : a.count;
      const right = sortColumn && sortColumn in b ? b[sortColumn as keyof typeof b] : b.count;
      const numericLeft = toNumber(left as TabularCell);
      const numericRight = toNumber(right as TabularCell);
      if (numericLeft != null && numericRight != null) return (numericLeft - numericRight) * direction;
      return cellText(left as TabularCell).localeCompare(cellText(right as TabularCell)) * direction;
    });
    const limit = Math.max(1, Math.min(Number(query.limit) || 50, 500));
    const columns = [groupBy, ...specs.map(aggregateLabel)];
    return {
      columns,
      rows: groups.slice(0, limit).map((group) => Object.fromEntries([[groupBy, group.key], ...specs.map((aggregate) => [aggregateLabel(aggregate), group[aggregateLabel(aggregate) as keyof typeof group] as TabularCell])]) as TabularRow),
      totalRows: source.rows.length,
      matchedRows: matched.length,
      returnedRows: Math.min(groups.length, limit),
      truncated: groups.length > limit,
      groups: groups.slice(0, limit),
      aggregates: Object.fromEntries(specs.map((aggregate) => [aggregateLabel(aggregate), computeAggregate(matched, aggregate)])),
      unknownColumns,
    };
  }

  const selected = (query.select ?? []).filter((column) => available.has(column));
  const columns = selected.length ? selected : [...source.columns, ...derivedNames];
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
  const limit = Math.max(1, Math.min(Number(query.limit) || MAX_MATERIALIZED_ROWS, MAX_MATERIALIZED_ROWS));
  return {
    columns,
    rows: rows.slice(0, limit).map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ''])) as TabularRow),
    totalRows: source.rows.length,
    matchedRows: matched.length,
    returnedRows: Math.min(rows.length, limit),
    truncated: rows.length > limit,
    ...(aggregates.length ? { aggregates: Object.fromEntries(aggregates.map((aggregate) => [aggregateLabel(aggregate), computeAggregate(matched, aggregate)])) } : {}),
    unknownColumns,
  };
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

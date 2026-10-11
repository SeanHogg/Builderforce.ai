/**
 * THE Insights filter registry.
 *
 * Device, country, path, UTM, frustration, duration — declared once so the
 * URL, the query builder, the Insights views and the API parse the same
 * vocabulary. A filter the UI writes is a filter the list endpoint can
 * read, and the other way around.
 */

export const FILTER_OPERATORS = ['eq', 'neq', 'in', 'contains', 'gte', 'lte'] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export type FilterFieldType = 'string' | 'number' | 'enum' | 'boolean';

export interface FilterFieldSpec {
  readonly key: string;
  readonly type: FilterFieldType;
  readonly operators: readonly FilterOperator[];
  readonly values?: readonly string[];
}

export const FILTER_FIELDS: readonly FilterFieldSpec[] = [
  { key: 'device', type: 'enum', operators: ['eq', 'in'], values: ['mobile', 'desktop', 'tablet'] },
  { key: 'country', type: 'string', operators: ['eq', 'in'] },
  { key: 'path', type: 'string', operators: ['eq', 'contains'] },
  { key: 'entryPath', type: 'string', operators: ['eq', 'contains'] },
  { key: 'exitPath', type: 'string', operators: ['eq', 'contains'] },
  { key: 'utmSource', type: 'string', operators: ['eq', 'in'] },
  { key: 'utmCampaign', type: 'string', operators: ['eq', 'in'] },
  { key: 'utmMedium', type: 'string', operators: ['eq', 'in'] },
  { key: 'referrer', type: 'string', operators: ['eq', 'contains'] },
  {
    key: 'frustration',
    type: 'enum',
    operators: ['eq', 'in'],
    values: ['rage', 'dead', 'quickback', 'excessive_scroll', 'error'],
  },
  { key: 'durationMs', type: 'number', operators: ['gte', 'lte'] },
  { key: 'releaseKey', type: 'string', operators: ['eq', 'in'] },
  { key: 'hasError', type: 'boolean', operators: ['eq'] },
];

export const FILTER_FIELD_BY_KEY: ReadonlyMap<string, FilterFieldSpec> = new Map(
  FILTER_FIELDS.map((field) => [field.key, field]),
);

export interface ReplayFilterClause {
  field: string;
  op: FilterOperator;
  value: string | number | boolean | ReadonlyArray<string | number>;
}

export interface ReplayFilter {
  clauses: ReplayFilterClause[];
}

const OPERATOR_SET = new Set<string>(FILTER_OPERATORS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coerceValue(spec: FilterFieldSpec, raw: string): string | number | boolean | null {
  if (spec.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (spec.type === 'boolean') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return null;
  }
  if (spec.type === 'enum' && spec.values && !spec.values.includes(raw)) return null;
  return raw;
}

function isOperator(value: string): value is FilterOperator {
  return OPERATOR_SET.has(value);
}

function parseClause(raw: unknown): ReplayFilterClause | null {
  if (!isRecord(raw)) return null;
  const field = raw.field;
  const op = raw.op;
  if (typeof field !== 'string' || typeof op !== 'string') return null;
  const spec = FILTER_FIELD_BY_KEY.get(field);
  if (!spec || !isOperator(op) || !spec.operators.includes(op)) return null;
  const value = raw.value;
  if (Array.isArray(value)) {
    if (op !== 'in') return null;
    const items = value.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
    if (items.length === 0) return null;
    return { field, op, value: items };
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { field, op, value };
  }
  return null;
}

/**
 * Accept a `ReplayFilter`, a `{ field: value }` shorthand, a query string,
 * or `URLSearchParams`. Invalid input returns null rather than throwing —
 * a bad URL must not take the Insights page down.
 */
export function parseReplayFilter(raw: unknown): ReplayFilter | null {
  if (raw == null || raw === '') return { clauses: [] };
  if (typeof raw === 'string' || raw instanceof URLSearchParams) {
    return filterFromQuery(typeof raw === 'string' ? new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw) : raw);
  }
  if (!isRecord(raw)) return null;
  if (Array.isArray(raw.clauses)) {
    const clauses: ReplayFilterClause[] = [];
    for (const item of raw.clauses) {
      const clause = parseClause(item);
      if (!clause) return null;
      clauses.push(clause);
    }
    return { clauses };
  }
  const clauses: ReplayFilterClause[] = [];
  for (const [field, value] of Object.entries(raw)) {
    if (field === 'clauses') continue;
    const spec = FILTER_FIELD_BY_KEY.get(field);
    if (!spec) return null;
    if (Array.isArray(value)) {
      if (!spec.operators.includes('in')) return null;
      const items = value.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
      if (items.length === 0) return null;
      clauses.push({ field, op: 'in', value: items });
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      clauses.push({ field, op: 'eq', value });
      continue;
    }
    return null;
  }
  return { clauses };
}

/** Encode a filter as query params (`device=mobile`, `durationMs.gte=5000`). */
export function filterToQuery(filter: ReplayFilter): URLSearchParams {
  const params = new URLSearchParams();
  for (const clause of filter.clauses) {
    const key = clause.op === 'eq' ? clause.field : `${clause.field}.${clause.op}`;
    if (Array.isArray(clause.value)) {
      for (const item of clause.value) params.append(key, String(item));
    } else {
      params.append(key, String(clause.value));
    }
  }
  return params;
}

/** Decode query params into a filter, dropping unknown fields / operators. */
export function filterFromQuery(params: URLSearchParams): ReplayFilter {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    const list = grouped.get(key);
    if (list) list.push(value);
    else grouped.set(key, [value]);
  }
  const clauses: ReplayFilterClause[] = [];
  for (const [key, values] of grouped) {
    const dot = key.lastIndexOf('.');
    const field = dot === -1 ? key : key.slice(0, dot);
    const opRaw = dot === -1 ? 'eq' : key.slice(dot + 1);
    const spec = FILTER_FIELD_BY_KEY.get(field);
    if (!spec || !isOperator(opRaw) || !spec.operators.includes(opRaw)) continue;
    if (opRaw === 'in' || values.length > 1) {
      const items: Array<string | number> = [];
      for (const raw of values) {
        const coerced = coerceValue(spec, raw);
        if (coerced === null || typeof coerced === 'boolean') continue;
        items.push(coerced);
      }
      if (items.length === 0) continue;
      clauses.push({ field, op: spec.operators.includes('in') ? 'in' : opRaw, value: items });
      continue;
    }
    const coerced = coerceValue(spec, values[0]!);
    if (coerced === null) continue;
    clauses.push({ field, op: opRaw, value: coerced });
  }
  return { clauses };
}

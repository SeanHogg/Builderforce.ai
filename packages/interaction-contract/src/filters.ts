/**
 * THE Insights filter (PRD 33 §3.4) — one contract, one compiler.
 *
 * Every band, panel, list and the read API take a `ReplayFilter`. The
 * fields are declared once here (`FILTER_FIELDS`) so the URL, the filter bar,
 * the API parser and the compiler read one vocabulary; a filter the UI writes
 * is a filter the API can read, and the other way around.
 */

import type { ReplayDeviceClass } from './api';
import { FRUSTRATION_MARK_KINDS } from './kinds';

export const FILTER_OPS = ['eq', 'neq', 'in', 'contains', 'prefix', 'gte', 'lte'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/**
 * - `string` / `number` / `boolean`: a scalar of that type.
 * - `enum`: one of the field's `values`.
 * - `keyValue`: `"key=value"` (tags).
 * An `in` clause carries a non-empty list of the scalar kind.
 */
export type FilterValueKind = 'string' | 'number' | 'boolean' | 'enum' | 'keyValue';

export const FILTER_FIELD_IDS = [
  'device',
  'browser',
  'os',
  'country',
  'referrer',
  'entryPath',
  'exitPath',
  'visitedPath',
  'clickedSelector',
  'frustration',
  'durationMs',
  'activeMs',
  'pageCount',
  'release',
  'smartEvent',
  'tag',
  'converted',
  'variant',
  'issue',
] as const;

export type FilterFieldId = (typeof FILTER_FIELD_IDS)[number];

export interface FilterFieldSpec {
  readonly id: FilterFieldId;
  readonly ops: readonly FilterOp[];
  readonly valueKind: FilterValueKind;
  /** Allowed values of an `enum` field. */
  readonly values?: readonly string[];
}

const DEVICE_VALUES: readonly ReplayDeviceClass[] = ['desktop', 'tablet', 'phone'];
const TEXT_OPS: readonly FilterOp[] = ['eq', 'neq', 'in', 'contains'];
const PATH_OPS: readonly FilterOp[] = ['eq', 'neq', 'in', 'contains', 'prefix'];
const RANGE_OPS: readonly FilterOp[] = ['gte', 'lte'];
const LIST_OPS: readonly FilterOp[] = ['eq', 'neq', 'in'];

export const FILTER_FIELDS: readonly FilterFieldSpec[] = [
  { id: 'device', ops: LIST_OPS, valueKind: 'enum', values: DEVICE_VALUES },
  { id: 'browser', ops: LIST_OPS, valueKind: 'string' },
  { id: 'os', ops: LIST_OPS, valueKind: 'string' },
  { id: 'country', ops: LIST_OPS, valueKind: 'string' },
  { id: 'referrer', ops: TEXT_OPS, valueKind: 'string' },
  { id: 'entryPath', ops: PATH_OPS, valueKind: 'string' },
  { id: 'exitPath', ops: PATH_OPS, valueKind: 'string' },
  { id: 'visitedPath', ops: PATH_OPS, valueKind: 'string' },
  { id: 'clickedSelector', ops: ['eq', 'neq', 'contains'], valueKind: 'string' },
  { id: 'frustration', ops: LIST_OPS, valueKind: 'enum', values: FRUSTRATION_MARK_KINDS },
  { id: 'durationMs', ops: RANGE_OPS, valueKind: 'number' },
  { id: 'activeMs', ops: RANGE_OPS, valueKind: 'number' },
  { id: 'pageCount', ops: ['eq', 'gte', 'lte'], valueKind: 'number' },
  { id: 'release', ops: LIST_OPS, valueKind: 'string' },
  { id: 'smartEvent', ops: LIST_OPS, valueKind: 'string' },
  { id: 'tag', ops: ['eq', 'neq'], valueKind: 'keyValue' },
  { id: 'converted', ops: ['eq'], valueKind: 'boolean' },
  { id: 'variant', ops: LIST_OPS, valueKind: 'string' },
  /** An issue group's fingerprint (`replay_issues.fingerprint`) — "recordings that hit this issue". */
  { id: 'issue', ops: ['eq'], valueKind: 'string' },
];

export const FILTER_FIELD_BY_ID: ReadonlyMap<FilterFieldId, FilterFieldSpec> = new Map(
  FILTER_FIELDS.map((field) => [field.id, field]),
);

/** Most clauses one filter may carry. */
export const MAX_FILTER_CLAUSES = 12;
/** Most items in one `in` list. */
export const MAX_FILTER_LIST = 50;
/** Longest string value. */
export const MAX_FILTER_VALUE = 200;

export type FilterScalar = string | number | boolean;

export interface ReplayFilterClause {
  field: FilterFieldId;
  op: FilterOp;
  value: FilterScalar | ReadonlyArray<string | number>;
}

/** Every clause must hold (AND). */
export interface ReplayFilter {
  all: ReplayFilterClause[];
}

export const EMPTY_REPLAY_FILTER: ReplayFilter = { all: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFilterOp(value: unknown): value is FilterOp {
  return typeof value === 'string' && (FILTER_OPS as readonly string[]).includes(value);
}

function scalarOk(spec: FilterFieldSpec, value: unknown): value is FilterScalar {
  switch (spec.valueKind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && (spec.values ?? []).includes(value);
    case 'keyValue': {
      if (typeof value !== 'string' || value.length > MAX_FILTER_VALUE) return false;
      const eq = value.indexOf('=');
      return eq > 0;
    }
    case 'string':
      return typeof value === 'string' && value.length > 0 && value.length <= MAX_FILTER_VALUE;
  }
}

function parseClause(raw: unknown): ReplayFilterClause | null {
  if (!isRecord(raw)) return null;
  const spec = FILTER_FIELD_BY_ID.get(raw.field as FilterFieldId);
  if (!spec) return null;
  const op = raw.op;
  if (!isFilterOp(op) || !spec.ops.includes(op)) return null;
  const value = raw.value;
  if (op === 'in') {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FILTER_LIST) return null;
    const items: Array<string | number> = [];
    for (const item of value) {
      if (!scalarOk(spec, item) || typeof item === 'boolean') return null;
      items.push(item);
    }
    return { field: spec.id, op, value: items };
  }
  if (!scalarOk(spec, value)) return null;
  return { field: spec.id, op, value };
}

/**
 * Validate an untrusted filter. `null` / `undefined` is the empty filter;
 * anything else must be `{ all: clause[] }` with at most
 * `MAX_FILTER_CLAUSES` clauses, each naming a registered field, one of its
 * ops and a value of its kind. Returns null (never throws) otherwise.
 */
export function parseReplayFilter(raw: unknown): ReplayFilter | null {
  if (raw === null || raw === undefined) return { all: [] };
  if (!isRecord(raw) || !Array.isArray(raw.all)) return null;
  if (raw.all.length > MAX_FILTER_CLAUSES) return null;
  const all: ReplayFilterClause[] = [];
  for (const item of raw.all) {
    const clause = parseClause(item);
    if (!clause) return null;
    all.push(clause);
  }
  return { all };
}

/** Query-param prefix, so filter params never collide with `site`, `days`, `panel`. */
const PARAM_PREFIX = 'f.';

function encodeScalar(value: string | number | boolean): string {
  return String(value);
}

function decodeScalar(spec: FilterFieldSpec, raw: string): FilterScalar | null {
  if (spec.valueKind === 'number') {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (spec.valueKind === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  }
  return raw;
}

/**
 * Encode a filter as query params: one `f.<field>.<op>=<value>` per clause.
 * An `in` list is its items URI-encoded and joined by commas, so an item may
 * itself contain a comma.
 */
export function filterToQuery(filter: ReplayFilter): URLSearchParams {
  const params = new URLSearchParams();
  for (const clause of filter.all) {
    const key = `${PARAM_PREFIX}${clause.field}.${clause.op}`;
    const value = Array.isArray(clause.value)
      ? clause.value.map((item) => encodeURIComponent(String(item))).join(',')
      : encodeScalar(clause.value as FilterScalar);
    params.append(key, value);
  }
  return params;
}

/**
 * Decode `filterToQuery` output. Params without the `f.` prefix are ignored
 * (the URL carries other state). Malformed filter params are dropped, and the
 * result is held to `parseReplayFilter`'s rules.
 */
export function filterFromQuery(params: URLSearchParams | string): ReplayFilter {
  const search = typeof params === 'string'
    ? new URLSearchParams(params.startsWith('?') ? params.slice(1) : params)
    : params;
  const all: ReplayFilterClause[] = [];
  search.forEach((rawValue, key) => {
    if (!key.startsWith(PARAM_PREFIX) || all.length >= MAX_FILTER_CLAUSES) return;
    const rest = key.slice(PARAM_PREFIX.length);
    const dot = rest.lastIndexOf('.');
    if (dot <= 0) return;
    const spec = FILTER_FIELD_BY_ID.get(rest.slice(0, dot) as FilterFieldId);
    const op = rest.slice(dot + 1);
    if (!spec || !isFilterOp(op)) return;
    let value: unknown;
    if (op === 'in') {
      const items: Array<string | number> = [];
      for (const part of rawValue.split(',')) {
        let decoded: string;
        try {
          decoded = decodeURIComponent(part);
        } catch {
          return;
        }
        const item = decodeScalar(spec, decoded);
        if (item === null || typeof item === 'boolean') return;
        items.push(item);
      }
      value = items;
    } else {
      value = decodeScalar(spec, rawValue);
    }
    const clause = parseClause({ field: spec.id, op, value });
    if (clause) all.push(clause);
  });
  return { all };
}

/**
 * A copy of `params` carrying `filter` in place of whatever filter it held:
 * every `f.` param is dropped, the filter's own params appended, and every
 * other param (site, days, panel) kept. The ONE way a surface writes the
 * filter into an address without touching the rest of it.
 */
export function withFilterQuery(params: URLSearchParams | string, filter: ReplayFilter): URLSearchParams {
  const source = typeof params === 'string'
    ? new URLSearchParams(params.startsWith('?') ? params.slice(1) : params)
    : params;
  const next = new URLSearchParams();
  source.forEach((value, key) => {
    if (!key.startsWith(PARAM_PREFIX)) next.append(key, value);
  });
  filterToQuery(filter).forEach((value, key) => next.append(key, value));
  return next;
}

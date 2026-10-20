/**
 * The DB layer of the Evermind learning pipeline (roadmap 07bc5793).
 *
 * `learningPipeline.test.ts` covers the PURE half — `extractCandidate` and
 * `pipelineMetrics` — and it was fully green when two tenancy bugs shipped
 * inside this file's functions. That is the whole point of this suite: unit tests
 * over pure functions CANNOT catch a missing tenant predicate, because the
 * predicate is not theirs. Commit acd26e987 fixed the review and transfer
 * UPDATEs on `evermind_learning_candidates`, which filtered by candidate id
 * alone. Those tests stayed green through the bug.
 *
 * WHY THIS DOUBLE IS STATEFUL. The sibling idiom in this repo (`test/fakeDb.ts`,
 * and the local `fakeDb` helpers in `projectMemory.test.ts` /
 * `projectFacts.retirement.test.ts`) is a FIFO queue: `.from(table).where(…)`
 * resolves to the next pre-canned result, and the PREDICATE IS IGNORED. That is
 * the right double when the assertion is "did the code emit a tenant predicate"
 * and it is exactly the WRONG double here: under a FIFO double, a cross-tenant
 * read returns whatever row was queued next, so "a candidate in another tenant
 * returns null" would pass VACUOUSLY — it would pass no matter what the code did.
 *
 * So this double stores rows per TABLE IDENTITY and really evaluates the Drizzle
 * predicate against them (see {@link evaluate}). A row whose tenant differs is
 * then genuinely invisible to a tenant-scoped query, exactly as in Postgres, and
 * the isolation assertions below mean something. It supports the small statement
 * vocabulary this module and `upsertProjectFact` actually build — equality,
 * inequality, `is [not] null`, ordering and limits — and applies the schema's
 * column defaults on insert so `status`/`createdAt`/`contradicts` behave as the
 * database would rather than as the call site assumes.
 *
 * NOTHING IS MOCKED. Not `getProjectEvermindHead`, not `upsertProjectFact`, not
 * `reportCaughtError`. With a bare `Env` the KV cache falls through to its loader
 * and the embedding provider degrades to "no vector", both of which the
 * production code already treats as normal — so the writes under test are the
 * real ones, and the fact a transfer produces is the row a recall would read.
 * (For the same reason a FAILURE test cannot use a mock: a mock would be
 * asserting that a mock was called.)
 */
import { describe, expect, it, vi } from 'vitest';
import { SQL } from 'drizzle-orm';
import {
  captureLearningBaseline,
  learningPipelineReport,
  recordLearningRun,
  reviewLearningCandidate,
  transferLearningCandidate,
} from './evermindLearningPipeline';
import {
  evermindLearningBaselines,
  evermindLearningCandidates,
  evermindLearningRuns,
  projectEvermind,
  projectFacts,
} from '../../infrastructure/database/schema/delivery';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Bare env: no AUTH_CACHE_KV (cache falls through to the loader), no provider key. */
const env = {} as Env;

const TENANT = 3;
const OTHER_TENANT = 7;
const PROJECT = 42;
const OTHER_PROJECT = 99;

// ---------------------------------------------------------------------------
// Drizzle predicate → SQL text, and SQL → per-row boolean
// ---------------------------------------------------------------------------

/**
 * Flatten a Drizzle SQL tree to text so a predicate can be asserted on.
 *
 * Guards on SEEN objects, not just depth: a `Column` holds a reference back to
 * its table, which holds every other column, so blind recursion never terminates.
 * (Same traversal, and for the same reason, as `projectFacts.retirement.test.ts`.)
 */
function sqlText(value: unknown, seen: Set<unknown> = new Set()): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((v) => sqlText(v, seen)).join(' ');
  if (value instanceof SQL) return sqlText(value.queryChunks, seen);
  if (typeof value === 'object') {
    if (seen.has(value)) return '';
    seen.add(value);
    const record = value as Record<string, unknown>;
    // A Column's `name` is what an assertion should match on; recursing into its
    // other fields would only emit its table's columns as well.
    if (isColumn(value)) return record.name as string;
    if ('queryChunks' in record) return sqlText(record.queryChunks, seen);
    if ('value' in record) return sqlText(record.value, seen);
    return Object.values(record).map((v) => sqlText(v, seen)).join(' ');
  }
  return String(value);
}

type Token =
  | { kind: 'col'; name: string }
  | { kind: 'param'; value: unknown }
  | { kind: 'text'; text: string };

/** A `Column`, identified without recursing into its table back-reference. */
function isColumn(value: unknown): value is { name: string } {
  return typeof value === 'object' && value !== null
    && typeof (value as { name?: unknown }).name === 'string'
    && (value as { table?: unknown }).table != null;
}

/**
 * Depth-first flatten of a predicate into a flat token stream.
 *
 * The nesting inside `and(eq(a,1), eq(b,2))` — the parentheses, the nested `SQL`
 * nodes — carries no meaning for matching, so it is flattened away and only
 * column / operator / value triples survive.
 */
function tokens(node: unknown, out: Token[] = []): Token[] {
  if (node == null) return out;
  if (Array.isArray(node)) {
    for (const item of node) tokens(item, out);
    return out;
  }
  if (isColumn(node)) {
    out.push({ kind: 'col', name: node.name });
    return out;
  }
  if (node instanceof SQL) return tokens(node.queryChunks, out);
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    // A `Param` carries one value; a `StringChunk` carries an ARRAY of strings
    // (that is where `' = '`, `' and '` and the parentheses live). Treating the
    // chunk as a param would hide every operator, which is the one thing this
    // traversal exists to find.
    if ('value' in record && !('queryChunks' in record)) {
      const value = (record as { value: unknown }).value;
      if (typeof value === 'string') out.push({ kind: 'text', text: value });
      else if (Array.isArray(value)) out.push({ kind: 'text', text: value.map((v) => String(v)).join('') });
      else out.push({ kind: 'param', value });
      return out;
    }
    if ('queryChunks' in record) return tokens(record.queryChunks, out);
    return out;
  }
  if (typeof node === 'string') out.push({ kind: 'text', text: node });
  return out;
}

interface Atom {
  column: string;
  op: string;
  value?: unknown;
}

/**
 * Pull `<col> <op> [<value>]` triples out of a token stream.
 *
 * Three shapes of the same grammar showed up while building this, all worth
 * pinning down because each one silently produces a WRONG filter rather than an
 * obvious error:
 *
 *  1. An operator can be split across StringChunks (`isNull` emits `' is '` then
 *     `' null'`), so consecutive text runs are joined before trimming.
 *  2. A STRING parameter is emitted as a bare text token (`'qa-cache'`), not a
 *     `Param` — only a number/boolean/Date arrives as `Param`. So `ne(source,
 *     'qa-cache')` is `col`, `" <> "`, `'qa-cache'`, `""`, `")"`. Treating that
 *     middle token as more operator text yields the classic bogus
 *     `unsupported operator "<> qa-cache) and ("`.
 *  3. `sql\`${col} is not null\`` renders as `col`, `' is not null'` with NO value.
 *
 * A text run therefore stops at the next column, at a real Param, or at a
 * non-blank non-operator token — which is the string-parameter case.
 */
function atoms(predicate: unknown): Atom[] {
  const stream = tokens(predicate);
  const found: Atom[] = [];
  for (let i = 0; i < stream.length; i++) {
    const head = stream[i]!;
    if (head.kind !== 'col') continue;
    const column = (head as { name: string }).name;
    let op = '';
    let j = i + 1;
    while (stream[j] && stream[j]!.kind === 'text' && (stream[j] as { text: string }).text.trim() === '') {
      j++;
    }
    op = ((stream[j] as { text?: string } | undefined)?.text ?? '').trim();
    if (op) {
      // Join any further text chunks that are still pure operator text.
      let k = j + 1;
      let joined = op;
      while (stream[k] && stream[k]!.kind === 'text' && /^(is (not )?null|null|not null)$/i.test((stream[k] as { text: string }).text.trim())) {
        joined += (stream[k] as { text: string }).text;
        k++;
      }
      op = joined.trim();
    }
    if (!op) { i = j; continue; }
    const lower = op.toLowerCase();
    if (/^is (not )?null$/.test(lower)) {
      found.push({ column, op: lower, value: null });
      i = j;
      continue;
    }
    const after = stream[j + 1];
    if (after && after.kind === 'param') {
      found.push({ column, op, value: after.value });
      i = j + 1;
      continue;
    }
    const strTok = after && after.kind === 'text' ? (after as { text: string }).text.trim() : '';
    if (strTok && !/^[()]|^(and|or)$/i.test(strTok)) {
      found.push({ column, op, value: strTok });
      i = j + 1;
      continue;
    }
    found.push({ column, op });
    i = j;
  }
  return found;
}

function matches(row: Record<string, unknown>, predicate: unknown): boolean {
  return atoms(predicate).every((atom) => {
    const actual = row[atom.column];
    switch (atom.op) {
      case '=':
      case '==':
        return actual === atom.value;
      case '<>':
      case '!=':
        return actual !== atom.value;
      case 'is null':
        return actual == null;
      case 'is not null':
        return actual != null;
      case '>':
        return (actual as number) > (atom.value as number);
      case '<':
        return (actual as number) < (atom.value as number);
      case '>=':
        return (actual as number) >= (atom.value as number);
      case '<=':
        return (actual as number) <= (atom.value as number);
      default:
        // An operator this double cannot evaluate must NOT silently pass every
        // row — that would turn an unsupported predicate into a leaked query.
        throw new Error(`fakeDb: unsupported predicate operator "${atom.op}" on ${atom.column}`);
    }
  });
}

// ---------------------------------------------------------------------------
// The stateful double
// ---------------------------------------------------------------------------

/** Column defaults, by column name, as Postgres would apply them. */
const COLUMN_DEFAULTS: Record<string, unknown> = {
  status: 'pending',
  contradicts: false,
  produced: false,
  headVersion: 0,
  factCount: 0,
};

const DATE_COLUMNS = new Set(['createdAt', 'capturedAt', 'updatedAt']);

/**
 * Columns Postgres declares NULLable. A stored row must carry an explicit
 * `null` for these rather than omitting the key, because the production code
 * reads them as `row.reviewedAt ?? now` and the tests read them with
 * `toBeNull()` — `undefined` would make a genuine "not reviewed yet" row
 * indistinguishable from a bug in the double.
 */
const NULLABLE_COLUMNS = new Set([
  'reviewedAt',
  'reviewedBy',
  'transferredAt',
  'benchBefore',
  'benchAfter',
  'baselineContent',
]);

type Row = Record<string, unknown>;

interface UpdateCall { table: unknown; set: Row; where: string; predicate: unknown }
interface InsertCall { table: unknown; values: Row; conflictTarget: string[] | null }

interface FakeDb {
  db: Db;
  rows: (table: unknown) => Row[];
  seed: (table: unknown, row: Row) => Row;
  updates: UpdateCall[];
  inserts: InsertCall[];
  /** Would this WHERE clause select this row? Row keys are COLUMN names. */
  matchesRow: (row: Row, predicate: unknown) => boolean;
  failOn: (table: unknown, op: 'insert' | 'update' | 'select') => void;
}

function fakeDb(): FakeDb {
  const store = new Map<unknown, Row[]>();
  const sequences = new Map<unknown, number>();
  const updates: UpdateCall[] = [];
  const inserts: InsertCall[] = [];
  const failures = new Map<string, unknown>();

  const rowsFor = (table: unknown): Row[] => {
    if (!store.has(table)) store.set(table, []);
    return store.get(table)!;
  };
  const tableKey = (table: unknown, op: string) => {
    // Tables are module singletons, so identity is a sound key; the op keeps
    // "insert fails" from also failing "select".
    const existing = failures.get(`${op}`) as Set<unknown> | undefined;
    return existing?.has(table);
  };
  const guard = (table: unknown, op: 'insert' | 'update' | 'select') => {
    if (tableKey(table, op)) throw new Error(`fakeDb: injected ${op} failure`);
  };

  const nextId = (table: unknown) => {
    const next = (sequences.get(table) ?? 0) + 1;
    sequences.set(table, next);
    return next;
  };

  /**
   * Materialise one row: map the caller's JS property names onto DB column
   * names, fill defaults, assign serial ids, keep the sequence ahead.
   *
   * Rows are stored keyed by `column.name` (`created_at`) because that is what a
   * predicate references, while both the production code and a seed helper write
   * the JS key (`createdAt`) — so the mapping happens here, once, instead of the
   * two conventions leaking into every assertion.
   */
  const materialise = (table: unknown, values: Row): Row => {
    const columns = table as unknown as Record<string, { name: string; constructor: { name: string } }>;
    const row: Row = {};
    for (const [jsKey, column] of Object.entries(columns)) {
      if (!column || typeof column.name !== 'string') continue;
      const isSerial = column.constructor?.name === 'PgSerial';
      let value = values[jsKey] ?? values[column.name];
      if (value === undefined) {
        if (isSerial) value = nextId(table);
        else if (DATE_COLUMNS.has(jsKey) || DATE_COLUMNS.has(column.name)) value = new Date();
        else if (jsKey in COLUMN_DEFAULTS) value = COLUMN_DEFAULTS[jsKey];
        else if (column.name in COLUMN_DEFAULTS) value = COLUMN_DEFAULTS[column.name];
        else if (NULLABLE_COLUMNS.has(jsKey) || NULLABLE_COLUMNS.has(column.name)) value = null;
      }
      if (isSerial && typeof value === 'number') {
        sequences.set(table, Math.max(sequences.get(table) ?? 0, value));
      }
      row[column.name] = value;
    }
    return row;
  };

  /**
   * Drizzle hands callers JS property names; rows are stored by column name.
   * This is that translation, in both directions, so a seed helper and an
   * assertion can both speak camelCase while predicates speak column names.
   */
  const jsKeys = (table: unknown): Map<string, string> => {
    const map = new Map<string, string>();
    for (const [jsKey, column] of Object.entries(table as Record<string, { name?: string }>)) {
      if (column && typeof column.name === 'string') map.set(column.name, jsKey);
    }
    return map;
  };
  const jsRow = (table: unknown, row: Row): Row => {
    const map = jsKeys(table);
    const out: Row = {};
    for (const [column, value] of Object.entries(row)) out[map.get(column) ?? column] = value;
    return out;
  };

  const project = (table: unknown, rows: Row[], projection: unknown): Row[] => {
    if (projection == null) return rows.map((row) => jsRow(table, row));
    if (typeof projection !== 'object') return rows;
    const fields = projection as Record<string, unknown>;
    return rows.map((row) => {
      const out: Row = {};
      for (const [key, field] of Object.entries(fields)) {
        // A projection may hold either a column or a raw aggregate SQL; an
        // aggregate is computed by the select handler, not per row.
        if (isColumn(field)) out[key] = row[(field as { name: string }).name];
      }
      return out;
    });
  };

  /** `count(*)::int` / `count(*) filter (where <col>)::int` — the only aggregates used. */
  const aggregate = (expr: SQL, rows: Row[]): number => {
    const text = sqlText(expr);
    const filter = /^count\(\*\)\s*filter\s*\(\s*where\s+([A-Za-z0-9_]+)\s*\)/i.exec(text);
    if (filter) return rows.filter((row) => Boolean(row[filter[1]!])).length;
    if (/count\(\*\)/i.test(text)) return rows.length;
    throw new Error(`fakeDb: unsupported aggregate "${text}"`);
  };

  type SelectArgs = {
    table: unknown;
    projection: unknown;
    predicates: unknown[];
    order: Array<{ column: string; desc: boolean }>;
    limit?: number;
  };

  const runSelect = (args: SelectArgs): Row[] => {
    const table = args.table;
    guard(table, 'select');
    let rows = rowsFor(table).filter((row) => args.predicates.every((p) => matches(row, p)));
    const fields = (args.projection ?? null) as Record<string, unknown> | null;
    const hasAggregate = fields != null && Object.values(fields).some((f) => f instanceof SQL);
    if (hasAggregate && fields) {
      // An aggregate yields exactly one row of scalars, keyed by the alias the
      // code gave it (`runs`, `produced`, …). Over an empty set Postgres still
      // returns one row of zeroes, and the code depends on that to report zeros.
      const scalars: Row = {};
      for (const [key, field] of Object.entries(fields)) {
        if (field instanceof SQL) scalars[key] = rows.length === 0 ? 0 : aggregate(field, rows);
      }
      return [scalars];
    }
    for (const { column, desc: descending } of [...args.order].reverse()) {
      rows = [...rows].sort((a, b) => {
        const left = a[column] as never;
        const right = b[column] as never;
        if (left === right) return 0;
        const order = left > right ? 1 : -1;
        return descending ? -order : order;
      });
    }
    if (args.limit != null) rows = rows.slice(0, args.limit);
    return project(table, rows, fields);
  };

  const selectChain = (args: SelectArgs) => {
    // Every stage is awaitable, because `learningPipelineReport` ends some
    // statements at `.where()` and others at `.limit()`.
    const chain: Record<string, unknown> = {
      from: (table: unknown) => { args.table = table; return chain; },
      where: (predicate: unknown) => { args.predicates.push(predicate); return chain; },
      orderBy: (...clauses: SQL[]) => {
        for (const clause of clauses) {
          const text = sqlText(clause);
          const column = atoms(clause)[0]?.column;
          if (column) args.order.push({ column, desc: /\bdesc\b/i.test(text) });
        }
        return chain;
      },
      limit: (n: number) => { args.limit = n; return chain; },
      then: (onOk: (value: Row[]) => unknown, onErr?: (reason: unknown) => unknown) =>
        Promise.resolve().then(() => runSelect(args)).then(onOk, onErr),
    };
    return chain;
  };

  /** Apply a `set` payload (JS keys) onto a stored row (column keys). */
  const applySet = (table: unknown, row: Row, set: Row) => {
    const columns = table as Record<string, { name: string }>;
    for (const [jsKey, value] of Object.entries(set)) {
      const column = columns[jsKey]?.name;
      row[column ?? jsKey] = value;
    }
  };

  const insertChain = (table: unknown) => {
    let values: Row = {};
    guard(table, 'insert');
    const chain: Record<string, unknown> = {
      values: (payload: Row) => {
        values = { ...values, ...payload };
        inserts.push({ table, values: payload, conflictTarget: null });
        return chain;
      },
      onConflictDoUpdate: (config: { target: unknown[]; set: Row }) => {
        const target = (config.target ?? []) as Array<{ name: string }>;
        // Attribute the conflict target to the `.values()` this belongs to, so a
        // test can assert which unique index a write upserts onto.
        const last = inserts.filter((call) => call.table === table).pop();
        if (last) last.conflictTarget = target.map((column) => column.name);
        // `values` is keyed by the JS property names the caller passed, while a
        // stored row is keyed by DB column name — compare each target column
        // through the column's JS key so `[tenantId, projectId]` actually
        // matches instead of silently inserting a duplicate row.
        const columns = table as Record<string, { name: string }>;
        const existing = rowsFor(table).find((row) =>
          target.every((column) => {
            const jsKey = Object.keys(columns).find((k) => columns[k]?.name === column.name) ?? column.name;
            return row[column.name] === values[jsKey];
          }));
        // ON CONFLICT DO UPDATE replaces in place; only a miss inserts, which is
        // what makes a second `captureLearningBaseline` an update, not a duplicate.
        if (existing) applySet(table, existing, config.set);
        else rowsFor(table).push(materialise(table, values));
        return Promise.resolve();
      },
      returning: (projection: unknown) =>
        Promise.resolve().then(() => {
          const row = materialise(table, values);
          rowsFor(table).push(row);
          return project(table, [row], projection);
        }),
      then: (onOk: (value: Row[]) => unknown, onErr?: (reason: unknown) => unknown) =>
        Promise.resolve().then(() => {
          rowsFor(table).push(materialise(table, values));
          return onOk(rowsFor(table).map((row) => jsRow(table, row)));
        }).catch(onErr),
    };
    return chain;
  };

  const updateChain = (table: unknown, set: Row) => {
    guard(table, 'update');
    let changed: Row[] = [];
    const chain: Record<string, unknown> = {
      set: (values: Row) => { Object.assign(set, values); return chain; },
      where: (predicate: unknown) => {
        updates.push({ table, set, where: sqlText(predicate), predicate });
        // The predicate is evaluated against real rows, so an UPDATE whose WHERE
        // lost its tenant predicate now WRITES ACROSS TENANTS — which is exactly
        // the bug the regression tests below must catch.
        changed = rowsFor(table).filter((row) => matches(row, predicate));
        for (const row of changed) applySet(table, row, set);
        return chain;
      },
      returning: (projection: unknown) => Promise.resolve().then(() => project(table, changed, projection)),
      then: (onOk: (value: Row[]) => unknown, onErr?: (reason: unknown) => unknown) =>
        Promise.resolve().then(() => onOk(changed.map((row) => jsRow(table, row)))).catch(onErr),
    };
    return chain;
  };

  const db = {
    select: (projection?: unknown) => selectChain({ table: null, projection, predicates: [], order: [] }),
    insert: (table: unknown) => insertChain(table),
    update: (table: unknown) => updateChain(table, {}),
  };

  return {
    // `as never`, matching the sibling suites: the production `Db` type is a
    // ~100-method Drizzle handle that no structural double could satisfy.
    db: db as never,
    // Both helpers hand rows back under their JS names, exactly as a real
    // select would, so a test never has to think about the two conventions.
    rows: (table: unknown) => rowsFor(table).map((row) => jsRow(table, row)),
    seed: (table, row) => {
      const materialised = materialise(table, row);
      rowsFor(table).push(materialised);
      return jsRow(table, materialised);
    },
    updates,
    inserts,
    // Exposed so a test can ask "would this WHERE clause select THIS row?" — the
    // question the tenant-isolation regressions actually need answered.
    matchesRow: (row: Row, predicate: unknown) => matches(row, predicate),
    failOn: (table, op) => {
      if (!failures.has(op)) failures.set(op, new Set<unknown>());
      (failures.get(op) as Set<unknown>).add(table);
    },
  };
}

/** Seed a pending candidate belonging to `tenantId`/`projectId`. */
function seedCandidate(
  fake: FakeDb,
  over: Partial<Row> = {},
  tenantId = TENANT,
  projectId = PROJECT,
): Row {
  return fake.seed(evermindLearningCandidates, {
    tenantId,
    projectId,
    runId: 1,
    statement: 'Auth uses PKCE OAuth through the identity gateway.',
    factKey: 'auth-flow',
    baselineContent: null,
    contradicts: false,
    status: 'pending',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    reviewedAt: null,
    reviewedBy: null,
    transferredAt: null,
    benchBefore: null,
    benchAfter: null,
    ...over,
  });
}

/** Seed a project fact the baseline snapshot can pick up. */
function seedFact(fake: FakeDb, over: Partial<Row> = {}, tenantId = TENANT, projectId = PROJECT): Row {
  return fake.seed(projectFacts, {
    tenantId,
    projectId,
    key: 'auth-flow',
    content: 'Auth uses PKCE OAuth through the identity gateway.',
    source: 'review',
    importance: 0.5,
    contentHash: 'hash-1',
    fileAnchors: null,
    expiresAt: null,
    supersededBy: null,
    embedding: null,
    embeddingModel: null,
    embeddedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  });
}

describe('captureLearningBaseline', () => {
  it('snapshots the project facts under the calling (tenant, project)', async () => {
    const fake = fakeDb();
    seedFact(fake, { key: 'a', content: 'Fact A about the service.' });
    seedFact(fake, { key: 'b', content: 'Fact B about the service.' });
    seedFact(fake, { key: 'other-tenant', content: 'Another tenant secret.' }, OTHER_TENANT);
    seedFact(fake, { key: 'other-project', content: 'Another project secret.' }, TENANT, OTHER_PROJECT);

    const result = await captureLearningBaseline(env, fake.db, TENANT, PROJECT);

    expect(result.factCount).toBe(2);
    expect(result.capturedAt).toBe(new Date(result.capturedAt).toISOString());
    const [baseline] = fake.rows(evermindLearningBaselines);
    expect(baseline).toMatchObject({ tenantId: TENANT, projectId: PROJECT, factCount: 2 });
    const keys = (baseline!.facts as Array<{ key: string }>).map((fact) => fact.key);
    expect(keys).toEqual(['a', 'b']);
    expect(keys).not.toContain('other-tenant');
    expect(keys).not.toContain('other-project');
  });

  it('excludes the Q&A cache rows — a cache is not knowledge', async () => {
    const fake = fakeDb();
    seedFact(fake, { key: 'real', content: 'A durable project fact.' });
    seedFact(fake, { key: 'cached', content: 'A cached question answer.', source: 'qa-cache' });

    const result = await captureLearningBaseline(env, fake.db, TENANT, PROJECT);

    expect(result.factCount).toBe(1);
  });

  it('records the project Evermind head version it captured against', async () => {
    const fake = fakeDb();
    fake.seed(projectEvermind, { tenantId: TENANT, projectId: PROJECT, version: 12, mode: 'connected', contributions: 3, inferenceEnabled: true });

    const result = await captureLearningBaseline(env, fake.db, TENANT, PROJECT);

    expect(result.headVersion).toBe(12);
    expect(fake.rows(evermindLearningBaselines)[0]!.headVersion).toBe(12);
  });

  it('UPSERTS onto (tenantId, projectId): capturing twice updates, never duplicates', async () => {
    const fake = fakeDb();
    seedFact(fake, { key: 'a', content: 'Fact A about the service.' });
    await captureLearningBaseline(env, fake.db, TENANT, PROJECT);

    seedFact(fake, { key: 'c', content: 'Fact C about the service.' });
    const second = await captureLearningBaseline(env, fake.db, TENANT, PROJECT);

    const rows = fake.rows(evermindLearningBaselines);
    expect(rows).toHaveLength(1);
    expect(second.factCount).toBe(2);
    expect(rows[0]!.factCount).toBe(2);
    // The conflict target is the pair, which is what makes the second write an
    // update rather than a second row.
    const baselineInsert = fake.inserts.filter((call) => call.table === evermindLearningBaselines);
    expect(baselineInsert).toHaveLength(2);
    expect(baselineInsert[1]!.conflictTarget).toEqual(['tenant_id', 'project_id']);
  });

  it('keeps each tenant and project on its OWN baseline row', async () => {
    const fake = fakeDb();
    seedFact(fake, { key: 'mine', content: 'A fact in the first project.' }, TENANT, PROJECT);
    seedFact(fake, { key: 'theirs', content: 'A fact in the second tenant.' }, OTHER_TENANT, PROJECT);

    await captureLearningBaseline(env, fake.db, TENANT, PROJECT);
    await captureLearningBaseline(env, fake.db, OTHER_TENANT, PROJECT);

    expect(fake.rows(evermindLearningBaselines)).toHaveLength(2);
    const mine = fake.rows(evermindLearningBaselines).find((row) => row.tenantId === TENANT)!;
    const theirs = fake.rows(evermindLearningBaselines).find((row) => row.tenantId === OTHER_TENANT)!;
    expect(mine.factCount).toBe(1);
    expect(theirs.factCount).toBe(1);
  });
});

describe('recordLearningRun', () => {
  it('records one run per learn and one candidate when the text is new', async () => {
    const fake = fakeDb();
    fake.seed(evermindLearningBaselines, { tenantId: TENANT, projectId: PROJECT, facts: [{ key: 'old', content: 'An older fact already known.' }], factCount: 1, headVersion: 3 });

    await recordLearningRun(env, fake.db, TENANT, PROJECT, 'The deploy pipeline requires a signed artifact.');

    expect(fake.rows(evermindLearningRuns)).toHaveLength(1);
    expect(fake.rows(evermindLearningRuns)[0]).toMatchObject({ tenantId: TENANT, projectId: PROJECT, produced: true });
    const candidates = fake.rows(evermindLearningCandidates);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ tenantId: TENANT, projectId: PROJECT, status: 'pending' });
    expect(candidates[0]!.statement).toBe('The deploy pipeline requires a signed artifact.');
    // The candidate hangs off the run that produced it.
    expect(candidates[0]!.runId).toBe(fake.rows(evermindLearningRuns)[0]!.id);
  });

  it('records the run but NO candidate when the text is already in the baseline', async () => {
    const fake = fakeDb();
    const known = 'The deploy pipeline requires a signed artifact.';
    fake.seed(evermindLearningBaselines, { tenantId: TENANT, projectId: PROJECT, facts: [{ key: 'deploy', content: known }], factCount: 1, headVersion: 3 });

    await recordLearningRun(env, fake.db, TENANT, PROJECT, known);

    expect(fake.rows(evermindLearningRuns)).toHaveLength(1);
    expect(fake.rows(evermindLearningRuns)[0]!.produced).toBe(false);
    expect(fake.rows(evermindLearningCandidates)).toHaveLength(0);
  });

  it('reads the baseline of the CALLING tenant only', async () => {
    const fake = fakeDb();
    const known = 'The deploy pipeline requires a signed artifact.';
    // The same text, but held by a different tenant — it must not suppress a
    // candidate for this tenant, and must not leak as baseline either.
    fake.seed(evermindLearningBaselines, { tenantId: OTHER_TENANT, projectId: PROJECT, facts: [{ key: 'deploy', content: known }], factCount: 1, headVersion: 3 });

    await recordLearningRun(env, fake.db, TENANT, PROJECT, known);

    expect(fake.rows(evermindLearningCandidates)).toHaveLength(1);
  });

  it('SWALLOWS a database failure: a ledger error must not fail an accepted teach', async () => {
    const fake = fakeDb();
    fake.failOn(evermindLearningRuns, 'insert');

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Snapshot the calls BEFORE restoring the spy: `mockRestore` puts the spy
    // back in its original state and wipes `mock.calls`, so asserting after the
    // `finally` would read an empty array and fail for the wrong reason.
    let caught: unknown[][] = [];
    try {
      // The documented contract: the weight update already succeeded, so this
      // resolves rather than rejecting.
      await expect(recordLearningRun(env, fake.db, TENANT, PROJECT, 'A statement new enough to become a candidate.')).resolves.toBeUndefined();
      caught = logged.mock.calls.filter((call) => call[0] === '[caught-error]');
    } finally {
      logged.mockRestore();
    }

    // …and the failure was REPORTED, not silently swallowed.
    expect(caught).toHaveLength(1);
    expect(caught[0]![1]).toMatchObject({ source: 'evermind-learning-pipeline', operation: 'record-run' });
  });

  it('still resolves when the head read fails, falling back to version 0', async () => {
    const fake = fakeDb();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.failOn(projectEvermind, 'select');
    // Captured before the restore — see the note on the test above.
    let operations: string[] = [];
    try {
      await expect(recordLearningRun(env, fake.db, TENANT, PROJECT, 'A statement new enough to become a candidate.')).resolves.toBeUndefined();
      operations = logged.mock.calls
        .filter((c) => c[0] === '[caught-error]')
        .map((c) => (c[1] as { operation: string }).operation);
    } finally {
      logged.mockRestore();
    }

    expect(fake.rows(evermindLearningRuns)).toHaveLength(1);
    expect(fake.rows(evermindLearningRuns)[0]!.headVersion).toBe(0);
    expect(operations).toContain('read-head');
  });
});

describe('reviewLearningCandidate', () => {
  it('moves a pending candidate to approved, stamping reviewer and time', async () => {
    const fake = fakeDb();
    const candidate = seedCandidate(fake);

    const result = await reviewLearningCandidate(fake.db, TENANT, PROJECT, candidate.id as number, 'approved', 'manager-1');

    expect(result).toMatchObject({ id: candidate.id, status: 'approved' });
    const stored = fake.rows(evermindLearningCandidates)[0]!;
    expect(stored.status).toBe('approved');
    expect(stored.reviewedBy).toBe('manager-1');
    expect(stored.reviewedAt).toBeInstanceOf(Date);
  });

  it('moves a pending candidate to rejected', async () => {
    const fake = fakeDb();
    const candidate = seedCandidate(fake);

    const result = await reviewLearningCandidate(fake.db, TENANT, PROJECT, candidate.id as number, 'rejected', null);

    expect(result).toMatchObject({ id: candidate.id, status: 'rejected' });
    expect(fake.rows(evermindLearningCandidates)[0]!.status).toBe('rejected');
  });

  it('re-reviewing an already-reviewed candidate returns the row UNCHANGED', async () => {
    const fake = fakeDb();
    const reviewedAt = new Date('2026-02-02T10:00:00.000Z');
    const candidate = seedCandidate(fake, { status: 'approved', reviewedBy: 'manager-1', reviewedAt });

    const result = await reviewLearningCandidate(fake.db, TENANT, PROJECT, candidate.id as number, 'rejected', 'manager-2');

    // The first verdict stands — a later reviewer cannot silently overturn it.
    expect(result).toMatchObject({ id: candidate.id, status: 'approved' });
    const stored = fake.rows(evermindLearningCandidates)[0]!;
    expect(stored.status).toBe('approved');
    expect(stored.reviewedBy).toBe('manager-1');
    expect(stored.reviewedAt).toBe(reviewedAt);
    // No UPDATE was issued at all.
    expect(fake.updates.filter((call) => call.table === evermindLearningCandidates)).toHaveLength(0);
  });

  it('returns null for a candidate that does not exist', async () => {
    const fake = fakeDb();
    await expect(reviewLearningCandidate(fake.db, TENANT, PROJECT, 999, 'approved', 'manager-1')).resolves.toBeNull();
  });

  it('tenant-isolation regression (acd26e987): a candidate in ANOTHER tenant returns null and is not mutated', async () => {
    const fake = fakeDb();
    const theirs = seedCandidate(fake, {}, OTHER_TENANT, PROJECT);

    const result = await reviewLearningCandidate(fake.db, TENANT, PROJECT, theirs.id as number, 'approved', 'intruder');

    expect(result).toBeNull();
    const stored = fake.rows(evermindLearningCandidates)[0]!;
    expect(stored.status).toBe('pending');
    expect(stored.reviewedBy).toBeNull();
    expect(stored.reviewedAt).toBeNull();
  });

  it('tenant-isolation regression (acd26e987): the review UPDATE is scoped to the calling tenant', async () => {
    const fake = fakeDb();
    const candidate = seedCandidate(fake);

    await reviewLearningCandidate(fake.db, TENANT, PROJECT, candidate.id as number, 'approved', 'manager-1');

    // The SELECT already filters by tenant, so on its own it would keep the
    // UPDATE safe by accident. The UPDATE must carry the tenant predicate too:
    // that is the clause acd26e987 added, and it is the one a future edit to
    // the WHERE would drop.
    const update = fake.updates.find((call) => call.table === evermindLearningCandidates)!;
    expect(update).toBeDefined();
    expect(update.where).toMatch(/tenant_id\s*=\s*3/);
    expect(update.where).toMatch(new RegExp(`id\\s*=\\s*${candidate.id}`));
  });

  it('does not touch a candidate belonging to a different PROJECT of the same tenant', async () => {
    const fake = fakeDb();
    const theirs = seedCandidate(fake, {}, TENANT, OTHER_PROJECT);

    await expect(reviewLearningCandidate(fake.db, TENANT, PROJECT, theirs.id as number, 'approved', 'manager-1')).resolves.toBeNull();
    expect(fake.rows(evermindLearningCandidates)[0]!.status).toBe('pending');
  });
});

describe('transferLearningCandidate', () => {
  it('happy path writes the project fact and stamps the transfer', async () => {
    const fake = fakeDb();
    const candidate = seedCandidate(fake, { status: 'approved', reviewedBy: 'manager-1', reviewedAt: new Date('2026-03-01T09:00:00.000Z') });

    const result = await transferLearningCandidate(env, fake.db, TENANT, PROJECT, candidate.id as number, { before: 0.4, after: 0.6, reviewerId: 'manager-1' });

    expect(result).toEqual({ ok: true, id: candidate.id });
    const facts = fake.rows(projectFacts);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      tenantId: TENANT,
      projectId: PROJECT,
      key: 'auth-flow',
      content: 'Auth uses PKCE OAuth through the identity gateway.',
      source: 'evermind-pipeline',
    });
    const stored = fake.rows(evermindLearningCandidates)[0]!;
    expect(stored.transferredAt).toBeInstanceOf(Date);
    expect(stored.status).toBe('approved');
    expect(stored.benchBefore).toBe(0.4);
    expect(stored.benchAfter).toBe(0.6);
  });

  it('is idempotent: an already-transferred candidate returns ok and writes no second fact', async () => {
    const fake = fakeDb();
    const transferredAt = new Date('2026-03-02T09:00:00.000Z');
    const candidate = seedCandidate(fake, { status: 'approved', transferredAt });

    const result = await transferLearningCandidate(env, fake.db, TENANT, PROJECT, candidate.id as number, { before: 0.4, after: 0.6 });

    expect(result).toEqual({ ok: true, id: candidate.id });
    expect(fake.rows(projectFacts)).toHaveLength(0);
    // The original transfer stamp survives the second call.
    expect(fake.rows(evermindLearningCandidates)[0]!.transferredAt).toBe(transferredAt);
    expect(fake.updates.filter((call) => call.table === evermindLearningCandidates)).toHaveLength(0);
  });

  it('refuses a REJECTED candidate with 409 and writes no fact', async () => {
    const fake = fakeDb();
    const candidate = seedCandidate(fake, { status: 'rejected' });

    const result = await transferLearningCandidate(env, fake.db, TENANT, PROJECT, candidate.id as number, {});

    expect(result).toEqual({ ok: false, error: 'a rejected learning cannot be transferred', status: 409 });
    expect(fake.rows(projectFacts)).toHaveLength(0);
    expect(fake.rows(evermindLearningCandidates)[0]!.transferredAt).toBeNull();
  });

  it('404s a candidate that does not exist', async () => {
    const fake = fakeDb();
    await expect(transferLearningCandidate(env, fake.db, TENANT, PROJECT, 4242, {})).resolves.toEqual({
      ok: false, error: 'candidate not found', status: 404,
    });
  });

  it('tenant-isolation regression (acd26e987): a candidate from ANOTHER tenant 404s and writes NOTHING', async () => {
    const fake = fakeDb();
    const theirs = seedCandidate(fake, { status: 'approved' }, OTHER_TENANT, PROJECT);

    const result = await transferLearningCandidate(env, fake.db, TENANT, PROJECT, theirs.id as number, { before: 0.1, after: 0.9 });

    expect(result).toEqual({ ok: false, error: 'candidate not found', status: 404 });
    // No fact written under EITHER tenant — the other tenant's statement is not
    // quietly promoted into the caller's memory.
    expect(fake.rows(projectFacts)).toHaveLength(0);
    const stored = fake.rows(evermindLearningCandidates)[0]!;
    expect(stored.tenantId).toBe(OTHER_TENANT);
    expect(stored.transferredAt).toBeNull();
    expect(stored.status).toBe('approved');
  });

  it('tenant-isolation regression (acd26e987): the transfer UPDATE is scoped to the calling tenant', async () => {
    const fake = fakeDb();
    const candidate = seedCandidate(fake, { status: 'approved' });

    await transferLearningCandidate(env, fake.db, TENANT, PROJECT, candidate.id as number, { before: 0.4, after: 0.6 });

    const update = fake.updates.find((call) => call.table === evermindLearningCandidates)!;
    expect(update).toBeDefined();
    expect(update.where).toMatch(/tenant_id\s*=\s*3/);
    expect(update.where).toMatch(new RegExp(`id\\s*=\\s*${candidate.id}`));

    // The behavioural half, and the half that actually pins acd26e987: the UPDATE
    // predicate is evaluated against a row owned by ANOTHER tenant and must NOT
    // select it. The tenant-scoped SELECT already refuses to *return* a foreign
    // row, so the visible behaviour (404, nothing written) stays correct even when
    // the UPDATE predicate is buggy — which is precisely how this defect shipped
    // unnoticed. Asserting the predicate directly is what makes the removal fail.
    const foreignRow = { id: candidate.id, tenantId: OTHER_TENANT, projectId: PROJECT, status: 'approved' };
    expect(fake.matchesRow(foreignRow, update.predicate)).toBe(false);
  });

  it('a rejected candidate returns 409 and writes no fact', async () => {
    const fake = fakeDb();
    const candidate = seedCandidate(fake, { status: 'rejected', reviewedBy: 'manager-1' });

    const result = await transferLearningCandidate(env, fake.db, TENANT, PROJECT, candidate.id as number, {});

    expect(result).toEqual({ ok: false, error: 'a rejected learning cannot be transferred', status: 409 });
    expect(fake.rows(projectFacts)).toHaveLength(0);
    expect(fake.rows(evermindLearningCandidates)[0]!.transferredAt).toBeNull();
  });

  it('refuses a PENDING (unreviewed) candidate with 409 and writes no fact', async () => {
    const fake = fakeDb();
    const candidate = seedCandidate(fake, { status: 'pending' });

    const result = await transferLearningCandidate(env, fake.db, TENANT, PROJECT, candidate.id as number, {});

    expect(result).toEqual({ ok: false, error: 'only an approved learning can be transferred', status: 409 });
    expect(fake.rows(projectFacts)).toHaveLength(0);
    expect(fake.rows(evermindLearningCandidates)[0]!.transferredAt).toBeNull();
    expect(fake.rows(evermindLearningCandidates)[0]!.status).toBe('pending');
  });

  it('the transfer claim re-asserts approved in its predicate (race-safe)', async () => {
    const fake = fakeDb();
    const candidate = seedCandidate(fake, { status: 'approved' });

    await transferLearningCandidate(env, fake.db, TENANT, PROJECT, candidate.id as number, {});

    const claim = fake.updates.find((call) => call.table === evermindLearningCandidates)!;
    const rejectedMeanwhile = { id: candidate.id, tenantId: TENANT, projectId: PROJECT, status: 'rejected' };
    expect(fake.matchesRow(rejectedMeanwhile, claim.predicate)).toBe(false);
  });

  // NOTE ON A BRANCH NOT COVERED HERE: `transferLearningCandidate` also maps a
  // falsy `upsertProjectFact` return to a 503 "project facts store refused the
  // learning". That branch is unreachable through the real collaborator without
  // mocking it — `upsertProjectFact` returns false ONLY for an empty key, empty
  // content or a non-positive projectId (all rejected earlier by the candidate
  // lookup), and its DB write is NOT wrapped in a catch, so a database failure
  // THROWS rather than returning false. Reaching it would mean stubbing
  // production code, which this suite deliberately does not do (nothing is
  // mocked — see the header). The 503 is therefore left unasserted rather than
  // covered by a test that cannot fail for a real reason.
});

describe('learningPipelineReport', () => {
  it('zero state returns ZEROS — never NaN, never a fabricated target', async () => {
    const fake = fakeDb();

    const report = await learningPipelineReport(fake.db, TENANT, PROJECT);

    expect(report.baseline).toBeNull();
    expect(report.pending).toEqual([]);
    expect(report.metrics).toEqual({
      runs: 0,
      produced: 0,
      candidates: 0,
      extractionRate: 0,
      reviewHours: null,
      contradictionRate: 0,
      transferUplift: null,
    });
    for (const [key, value] of Object.entries(report.metrics)) {
      if (typeof value === 'number') {
        expect(Number.isNaN(value), `${key} must not be NaN`).toBe(false);
        expect(Number.isFinite(value), `${key} must be finite`).toBe(true);
      }
    }
  });

  it('reports rates derived from the ledger, not invented', async () => {
    const fake = fakeDb();
    fake.seed(evermindLearningBaselines, { tenantId: TENANT, projectId: PROJECT, headVersion: 7, factCount: 4, capturedAt: new Date('2026-01-05T00:00:00.000Z') });
    for (let i = 0; i < 4; i++) {
      fake.seed(evermindLearningRuns, { tenantId: TENANT, projectId: PROJECT, headVersion: 7, produced: i < 2 });
    }
    seedCandidate(fake, { contradicts: true, status: 'pending', statement: 'A pending statement for the review queue.' });
    seedCandidate(fake, { contradicts: false, status: 'pending', statement: 'A second pending statement in the queue.' });

    const report = await learningPipelineReport(fake.db, TENANT, PROJECT);

    expect(report.baseline).toMatchObject({ headVersion: 7, factCount: 4 });
    expect(report.baseline!.capturedAt).toBe('2026-01-05T00:00:00.000Z');
    expect(report.metrics.runs).toBe(4);
    expect(report.metrics.produced).toBe(2);
    expect(report.metrics.candidates).toBe(2);
    expect(report.metrics.extractionRate).toBe(50);
    expect(report.metrics.contradictionRate).toBe(50);
    expect(report.pending).toHaveLength(2);
    expect(report.pending[0]).toMatchObject({ factKey: 'auth-flow', contradicts: true });
  });

  it('counts ONLY the calling tenant and project', async () => {
    const fake = fakeDb();
    seedCandidate(fake, {}, OTHER_TENANT, PROJECT);
    seedCandidate(fake, {}, TENANT, OTHER_PROJECT);
    fake.seed(evermindLearningRuns, { tenantId: OTHER_TENANT, projectId: PROJECT, produced: true });

    const report = await learningPipelineReport(fake.db, TENANT, PROJECT);

    expect(report.metrics.runs).toBe(0);
    expect(report.metrics.candidates).toBe(0);
    expect(report.pending).toEqual([]);
  });

  it('excludes reviewed rows from the pending queue', async () => {
    const fake = fakeDb();
    seedCandidate(fake, { status: 'approved', reviewedAt: new Date(), reviewedBy: 'manager-1' });
    seedCandidate(fake, { status: 'pending' });

    const report = await learningPipelineReport(fake.db, TENANT, PROJECT);

    expect(report.pending).toHaveLength(1);
    // The projection does not select `status` — the query hard-filters on
    // `status = 'pending'` — so the queue's meaning is "survived the filter".
    const queued = report.pending[0] as { status?: string };
    expect(queued.status).toBeUndefined();
    expect(report.pending[0]!.factKey).toBe('auth-flow');
  });

  it('computes review hours and transfer uplift from the reviewed rows', async () => {
    const fake = fakeDb();
    seedCandidate(fake, {
      status: 'approved',
      createdAt: new Date('2026-01-10T00:00:00.000Z'),
      reviewedAt: new Date('2026-01-10T04:00:00.000Z'),
      transferredAt: new Date('2026-01-11T00:00:00.000Z'),
      benchBefore: 0.5,
      benchAfter: 0.6,
    });

    const report = await learningPipelineReport(fake.db, TENANT, PROJECT);

    expect(report.metrics.reviewHours).toBe(4);
    expect(report.metrics.transferUplift).toBe(20);
  });

  it('leaves transferUplift null when no bench pair was recorded', async () => {
    const fake = fakeDb();
    seedCandidate(fake, { status: 'approved', reviewedAt: new Date(), transferredAt: new Date() });

    const report = await learningPipelineReport(fake.db, TENANT, PROJECT);

    expect(report.metrics.reviewHours).not.toBeNull();
    expect(report.metrics.transferUplift).toBeNull();
  });
});
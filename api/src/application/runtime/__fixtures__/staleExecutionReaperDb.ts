/**
 * Shared test fixture: an in-memory fake of the Drizzle `Db` for the stale-execution reaper tests
 * (staleExecutionReaper / pausedRunReaper / reaperChatNarration .test.ts), shared rather
 * than copied three times so the three fakes cannot drift apart.
 *
 * It speaks the reaper's statement shapes:
 *   • `db.execute` — the one-statement idle probe (../staleExecutionProbe.ts); reports
 *     `script.probe()` so a test chooses which sweeps run.
 *   • `db.select(...).from(...)[.innerJoin(...)].where(...)[.orderBy(...)][.limit(...)]`
 *     — the bounded cloud-candidate pull (projects `open_pr_count`), the batched
 *     ticket-kind read (projects `task_type`), and failStaleBatch's
 *     `id IN (SELECT … LIMIT 100)` subquery (anything else → no rows).
 *   • `db.update(...).set(...).where(...)[.returning(...)]` — routed through
 *     `script.onUpdate(set, params)`, where `params` are the WHERE's bound parameters in
 *     order. Each sweep binds its own status first (`'running'`, `'pending'/'submitted'`,
 *     `'paused'`); a single cloud fail binds the execution id first.
 *   • `db.delete(...).where(...)`, `db.insert(...).values(...)` — reported to hooks.
 *
 * Every statement kind is appended to `script.calls` so a test can assert e.g. that an
 * idle tick issues the probe only.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

type Row = Record<string, unknown>;

export interface ProbeRow {
  host_running: unknown;
  cloud_running: unknown;
  queued: unknown;
  paused: unknown;
  park_age: unknown;
}

export interface ReaperFakeDbScript {
  /** The idle probe's single row. Default: only `cloud_running`, when candidates exist. */
  probe: () => ProbeRow;
  /** Rows the stale cloud-candidate SELECT returns. */
  candidates: Row[];
  /** Rows the batched `tasks` ticket-kind read returns. */
  taskKinds: Row[];
  /** How many ticket-kind reads ran (the no-N+1 assertion). */
  taskKindReads: number;
  /** Statement kinds issued, in order: execute | candidates | tasks | select | update | delete | insert. */
  calls: string[];
  /** Rows an UPDATE returns. Default: none. */
  onUpdate: (set: Row, params: unknown[]) => Row[];
  onDelete: (params: unknown[]) => void;
  onInsert: (values: Row) => void;
}

export function newReaperFakeDbScript(overrides: Partial<ReaperFakeDbScript> = {}): ReaperFakeDbScript {
  const script: ReaperFakeDbScript = {
    probe: () => ({ host_running: false, cloud_running: script.candidates.length > 0, queued: false, paused: false, park_age: false }),
    candidates: [],
    taskKinds: [],
    taskKindReads: 0,
    calls: [],
    onUpdate: () => [],
    onDelete: () => {},
    onInsert: () => {},
    ...overrides,
  };
  return script;
}

const dialect = new PgDialect();
/** Bound parameters of a Drizzle WHERE clause, in order. */
export function paramsOf(where: unknown): unknown[] {
  return where ? dialect.sqlToQuery(where as SQL).params : [];
}

/** A builder leaf awaitable directly, via `.returning()`, and with `.catch()` attached. */
function leaf<T>(rows: T[]) {
  return {
    returning: () => Promise.resolve(rows),
    then: <R1, R2>(ok?: ((v: T[]) => R1 | PromiseLike<R1>) | null, err?: ((e: unknown) => R2 | PromiseLike<R2>) | null) =>
      Promise.resolve(rows).then(ok, err),
    catch: <R>(err?: ((e: unknown) => R | PromiseLike<R>) | null) => Promise.resolve(rows).catch(err),
  };
}

/** A SELECT `.where()` result: awaitable directly and through `.orderBy()` / `.limit()`. */
function selectResult(rows: Row[]) {
  const p = Promise.resolve(rows);
  const limited = Object.assign(Promise.resolve(rows), { limit: () => p });
  return Object.assign(Promise.resolve(rows), { limit: () => p, orderBy: () => limited });
}

export function createReaperFakeDb(script: ReaperFakeDbScript) {
  return {
    execute: () => {
      script.calls.push('execute');
      return Promise.resolve({ rows: [script.probe()] });
    },
    select: (fields: Record<string, unknown> = {}) => {
      const kind = 'open_pr_count' in fields ? 'candidates' : 'task_type' in fields ? 'tasks' : 'select';
      script.calls.push(kind);
      const where = () => {
        if (kind === 'candidates') return selectResult(script.candidates);
        if (kind === 'tasks') {
          script.taskKindReads += 1;
          return selectResult(script.taskKinds);
        }
        return selectResult([]);
      };
      return { from: () => ({ where, innerJoin: () => ({ where }) }) };
    },
    // Late-steer scan — no reaped run holds a pending steer in these tests.
    selectDistinct: () => ({ from: () => ({ where: () => selectResult([]) }) }),
    update: () => {
      script.calls.push('update');
      return {
        set: (set: Row) => ({
          where: (cond: unknown) => leaf(script.onUpdate(set, paramsOf(cond))),
        }),
      };
    },
    delete: () => {
      script.calls.push('delete');
      return {
        where: (cond: unknown) => {
          script.onDelete(paramsOf(cond));
          return leaf<Row>([]);
        },
      };
    },
    insert: () => {
      script.calls.push('insert');
      return {
        values: (v: Row) => {
          script.onInsert(v);
          return Promise.resolve();
        },
      };
    },
  };
}

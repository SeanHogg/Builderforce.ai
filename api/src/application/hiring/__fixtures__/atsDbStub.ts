/**
 * Shared test fixture: a Drizzle stand-in that SCRIPTS reads and RECORDS writes.
 *
 * The ATS's whole correctness argument is about which rows get written — a transition
 * closes the entry it left and stamps its clock, a reorder writes no entry at all, an
 * offer send mints exactly one signature request. None of that needs Postgres, and a test
 * that needed one would not run in CI at all (the same reasoning `hiringFunnel.test.ts`
 * gives for its own stub).
 *
 * Shared between `pipeline.test.ts`, `decisions.test.ts` and `offers.test.ts` rather than
 * copied three times: three stubs would be three slightly different opinions about what
 * `.returning()` does, and the day one of them drifted the test that depended on it would
 * pass while the code was wrong.
 */
import type { Db } from '../../../infrastructure/database/connection';

export interface RecordedWrite {
  op: 'insert' | 'update' | 'delete';
  /** The Drizzle table object, so a test compares by identity rather than by name. */
  table: unknown;
  /** `.values(…)` for an insert, `.set(…)` for an update. */
  payload: unknown;
}

export interface AtsDbStub {
  db: Db;
  /** Every write, in the order it was issued. */
  writes: RecordedWrite[];
  /** How many `select` statements ran — the N+1 guard. */
  selectCount: () => number;
}

/**
 * `rows` is consumed in order: the first `db.select(…)` resolves to `rows[0]`, the second
 * to `rows[1]`, and so on. `returning` supplies what an insert/update hands back, in the
 * same way.
 */
export function atsDbStub(script: { rows?: unknown[][]; returning?: unknown[][] } = {}): AtsDbStub {
  const writes: RecordedWrite[] = [];
  let selectIndex = 0;
  let returningIndex = 0;

  /**
   * One statement. Every chain method returns `this` and the object is thenable, so
   * `await` works wherever the real builder allows it — after `.where()`, after
   * `.returning()`, after `.limit()`.
   */
  class Statement {
    private table: unknown = null;
    private readonly rows: unknown[];
    /** What `.returning()` hands back, once it has been called. */
    private returned: unknown[] | null = null;

    constructor(private readonly op: 'select' | 'insert' | 'update' | 'delete', table?: unknown) {
      this.table = table ?? null;
      this.rows = op === 'select' ? (script.rows?.[selectIndex++] ?? []) : [];
    }

    from(table: unknown): this { this.table = table; return this; }
    leftJoin(): this { return this; }
    innerJoin(): this { return this; }
    where(): this { return this; }
    orderBy(): this { return this; }
    groupBy(): this { return this; }
    limit(): this { return this; }
    offset(): this { return this; }
    onConflictDoNothing(): this { return this; }
    onConflictDoUpdate(): this { return this; }

    values(payload: unknown): this {
      writes.push({ op: 'insert', table: this.table, payload });
      return this;
    }

    set(payload: unknown): this {
      writes.push({ op: 'update', table: this.table, payload });
      return this;
    }

    returning(): this {
      this.returned = script.returning?.[returningIndex++] ?? [{ id: 1 }];
      return this;
    }

    /** Thenable, so the statement resolves wherever it is awaited. */
    then<TResult1 = unknown, TResult2 = never>(
      onFulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.returned ?? this.rows).then(onFulfilled, onRejected);
    }

    catch<TResult = never>(onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null): Promise<unknown[] | TResult> {
      return Promise.resolve(this.returned ?? this.rows).catch(onRejected);
    }
  }

  const db = {
    select: () => new Statement('select'),
    insert: (table: unknown) => new Statement('insert', table),
    update: (table: unknown) => new Statement('update', table),
    delete: (table: unknown) => {
      writes.push({ op: 'delete', table, payload: null });
      return new Statement('delete', table);
    },
  } as unknown as Db;

  return { db, writes, selectCount: () => selectIndex };
}

/** A row as `readOpenEntries` returns it, with the fields a test does not care about
 *  filled in. */
export function openEntry(overrides: Partial<{
  entryId: number;
  applicationId: number | null;
  candidateRef: string;
  stage: string;
  position: number;
  enteredAt: Date;
  ownerRef: string | null;
  source: string | null;
  headline: string | null;
  yearsExp: string | null;
  skills: unknown;
  score: string | null;
}> = {}) {
  return {
    entryId: 1,
    applicationId: 10,
    candidateRef: 'person-1',
    stage: 'screen',
    position: 0,
    enteredAt: new Date('2026-08-01T00:00:00.000Z'),
    ownerRef: null,
    source: 'referral',
    headline: null,
    yearsExp: null,
    skills: [],
    score: null,
    ...overrides,
  };
}

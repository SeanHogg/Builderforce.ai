/**
 * PRD 09 S1 / S2: the drain is scoped to ONE execution and ordered deterministically.
 *
 * The fake database records the exact predicate and ORDER BY the real drizzle query
 * builds, and the tests render them to SQL with the Postgres dialect - so what is
 * asserted is the query shape that reaches the database, not a re-implementation of it.
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { pullPendingSteering } from './executionSteering';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);

function recordingDb(rows: Array<{ text: string }>) {
  const calls: { selectWhere?: SQL; orderBy?: SQL[]; updateWhere?: SQL } = {};
  const db = {
    select: () => ({
      from: () => ({
        where: (w: SQL) => {
          calls.selectWhere = w;
          return {
            orderBy: (...o: SQL[]) => {
              calls.orderBy = o;
              return Promise.resolve(rows);
            },
          };
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: (w: SQL) => {
          calls.updateWhere = w;
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as Db;
  return { db, calls };
}

describe('pullPendingSteering - isolation between executions (S1)', () => {
  it("selects only execution A's unconsumed user steers, in A's tenant", async () => {
    const { db, calls } = recordingDb([{ text: 'go left' }]);
    await pullPendingSteering(db, 7, 111);

    const q = render(calls.selectWhere!);
    expect(q.sql).toContain('"execution_messages"."tenant_id" = $');
    expect(q.sql).toContain('"execution_messages"."execution_id" = $');
    expect(q.sql).toContain('"execution_messages"."role" = $');
    expect(q.sql).toContain('"execution_messages"."consumed_at" is null');
    expect(q.params).toContain(7);
    expect(q.params).toContain(111);
    expect(q.params).toContain('user');
  });

  it("stamps consumed with the SAME execution scope, so B's pull can never consume A's steers", async () => {
    const a = recordingDb([{ text: 'a' }]);
    const b = recordingDb([{ text: 'b' }]);
    await pullPendingSteering(a.db, 7, 111);
    await pullPendingSteering(b.db, 7, 222);

    const aUpdate = render(a.calls.updateWhere!);
    const bUpdate = render(b.calls.updateWhere!);
    expect(aUpdate.sql).toContain('"execution_messages"."execution_id" = $');
    expect(aUpdate.params).toContain(111);
    expect(aUpdate.params).not.toContain(222);
    expect(bUpdate.params).toContain(222);
    expect(bUpdate.params).not.toContain(111);
  });

  it('does not touch the table when nothing is pending', async () => {
    const { db, calls } = recordingDb([]);
    expect(await pullPendingSteering(db, 7, 111)).toEqual([]);
    expect(calls.updateWhere).toBeUndefined();
  });

  it('returns the steer texts oldest-first and drops blank ones', async () => {
    const { db } = recordingDb([{ text: 'first' }, { text: '   ' }, { text: 'second' }]);
    expect(await pullPendingSteering(db, 7, 111)).toEqual(['first', 'second']);
  });
});

describe('pullPendingSteering - drain ordering (S2)', () => {
  it('orders by created_at, then id, so same-millisecond steers keep send order', async () => {
    const { db, calls } = recordingDb([{ text: 'one' }, { text: 'two' }]);
    await pullPendingSteering(db, 7, 111);

    const order = (calls.orderBy ?? []).map((o) => render(o).sql);
    expect(order).toEqual([
      '"execution_messages"."created_at" asc',
      '"execution_messages"."id" asc',
    ]);
  });
});

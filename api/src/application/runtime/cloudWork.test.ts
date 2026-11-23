import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { CHILD_WORK_RECORDED, readChildWork } from './cloudWork';

it('reads completed direct-child evidence in one tenant-scoped batch and checks the recorded assignment', async () => {
  const payload = (parentExecutionId: number, workItemIds: string[]) =>
    JSON.stringify({ subagent: { parentExecutionId, task: 'Slice', workItemIds } });
  const limit = vi.fn().mockResolvedValue([
    { id: 21, payload: payload(10, ['52']) },
    { id: 22, payload: payload(10, ['another-ticket']) },
    { id: 23, payload: payload(99, ['52']) },
    { id: 24, payload: null },
  ]);
  const where = vi.fn((_predicate: SQL) => ({ orderBy: () => ({ limit }) }));
  const innerJoin = vi.fn((_table: unknown, _predicate: SQL) => ({ where }));
  const db = { selectDistinct: () => ({ from: () => ({ innerJoin }) }) } as never;

  expect(await readChildWork(db, 3, 10, 52)).toEqual([
    { id: '52', status: 'in_review', detail: 'Delegated changes recorded by a21' },
  ]);
  expect(limit).toHaveBeenCalledTimes(1);
  const dialect = new PgDialect();
  const join = dialect.sqlToQuery(innerJoin.mock.calls[0]![1]);
  expect(join.params).toEqual([CHILD_WORK_RECORDED, 'run']);
  expect(join.sql).toContain('"tool_audit_events"."agent_host_id" is null');
  expect(dialect.sqlToQuery(where.mock.calls[0]![0]).params).toEqual([3, 10, 52, 'completed']);
});

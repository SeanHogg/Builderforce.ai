import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { expect, it, vi } from 'vitest';
import { releaseLateClaim, terminalExecutionsWithSteerRetries } from './lateSteerStore';

it('marks a released claim for retry and selects it only from terminal executions', async () => {
  const limit = vi.fn().mockResolvedValue([{ executionId: 10, tenantId: 3 }]);
  const where = vi.fn((_predicate: SQL) => ({ orderBy: () => ({ limit }) }));
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn((_values: { lateDetail?: string }) => ({ where: updateWhere }));
  const db = {
    update: () => ({ set }),
    selectDistinct: () => ({ from: () => ({ where }) }),
  } as never;

  await releaseLateClaim(db, 3, 10, [1]);
  expect(set).toHaveBeenCalledWith({ lateClaimedAt: null, consumedAt: null, lateDetail: 'pending_retry' });
  expect(await terminalExecutionsWithSteerRetries(db, 8)).toEqual([{ executionId: 10, tenantId: 3 }]);
  expect(limit).toHaveBeenCalledWith(8);
  const dialect = new PgDialect();
  const query = dialect.sqlToQuery(where.mock.calls[0]![0]);
  expect(query.params).toEqual(expect.arrayContaining(['completed', 'cancelled', 'user', 'pending_retry']));
  expect(query.sql).toContain('"execution_messages"."late_outcome" is null');
  expect(query.sql).toContain('"executions"."tenant_id" = "execution_messages"."tenant_id"');
});

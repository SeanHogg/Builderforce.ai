import { beforeEach, describe, expect, it } from 'vitest';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import { executionUsageCost, taskUsageCost } from './usageCostSummary';
import type { Db } from '../../infrastructure/database/connection';

/** GAP B2 — a run's own dollar figure, off the same ledger rows the ticket total sums. */
describe('usageCostSummary', () => {
  beforeEach(() => __clearL1CacheForTests());

  it("sums an execution's rows, tenant-scoped, and converts millicents to USD", async () => {
    const db = fakeDb([[{ cost_mc: '123456', tokens: '9876', requests: 4 }]]);
    const out = await executionUsageCost(undefined, db as unknown as Db, 7, 42);
    expect(out).toEqual({ estimatedCostUsd: 1.23456, totalTokens: 9876, requests: 4 });
    const cols = whereColumns(db.calls[0]?.where);
    expect(cols).toContain('tenant_id');
    expect(cols).toContain('execution_id');
  });

  it('keys the ticket total on task_id and answers zero for a degenerate id without a query', async () => {
    const db = fakeDb([[{ cost_mc: '0', tokens: '0', requests: 0 }]]);
    await taskUsageCost(undefined, db as unknown as Db, 7, 5);
    expect(whereColumns(db.calls[0]?.where)).toContain('task_id');
    const untouched = fakeDb([]);
    expect(await executionUsageCost(undefined, untouched as unknown as Db, 7, Number.NaN)).toEqual({ estimatedCostUsd: 0, totalTokens: 0, requests: 0 });
    expect(untouched.calls).toHaveLength(0);
  });
});

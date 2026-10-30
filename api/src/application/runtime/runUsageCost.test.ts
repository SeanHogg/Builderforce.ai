/**
 * resolveRunModel - what a cloud run cost, read from its usage ledger. (Unknown-cost-is-NULL semantics arrive with the cost-nullable
 * migration owned by ws4-canvas; until then no usage rows or a failed lookup read as 0, reported.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<{ model: string; n: number; cost: number }>,
  fail: false,
  report: vi.fn(),
}));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: h.report, reportedFallback: () => () => undefined }));
vi.mock('../llm/usageLedger', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  usageDatabaseOf: (db: unknown) => db,
  usageRequestCount: () => 'n',
}));

import { resolveRunModel } from './runUsageCost';

const db = {
  select: () => ({ from: () => ({ where: () => ({ groupBy: () => ({ orderBy: async () => { if (h.fail) throw new Error('usage db down'); return h.rows; } }) }) }) }),
} as never;

beforeEach(() => { h.rows = []; h.fail = false; h.report.mockClear(); });

describe('resolveRunModel', () => {
  it('no usage rows: no model, no steps, no cost', async () => {
    expect(await resolveRunModel(db, 9)).toEqual({ model: '', steps: 0, costMc: 0 });
  });

  it('a lookup that throws is reported and reads as nothing measured', async () => {
    h.fail = true;
    expect(await resolveRunModel(db, 9)).toEqual({ model: '', steps: 0, costMc: 0 });
    expect(h.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'resolveRunModel' }));
  });

  it('sums the cost and steps across models and names the most-used one', async () => {
    h.rows = [{ model: 'a', n: 5, cost: 700 }, { model: 'b', n: 2, cost: 300 }];
    expect(await resolveRunModel(db, 9)).toEqual({ model: 'a', steps: 7, costMc: 1000 });
  });
});

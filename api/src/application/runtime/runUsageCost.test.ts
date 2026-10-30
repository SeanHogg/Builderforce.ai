/**
 * The cloud scorer's row: an UNKNOWN cost is NULL, never free; a genuine zero stays zero. (The `client_run_id` the row is
 * keyed under is the domain's `cloudRunId`, tested with it.)
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

/** A db whose usage query answers `h.rows` (or throws), whatever the query builder is asked. */
const db = {
  select: () => ({ from: () => ({ where: () => ({ groupBy: () => ({ orderBy: async () => { if (h.fail) throw new Error('usage db down'); return h.rows; } }) }) }) }),
} as never;

beforeEach(() => { h.rows = []; h.fail = false; h.report.mockClear(); });

describe('resolveRunModel — what a run cost', () => {
  it('no usage rows: the cost is UNKNOWN (null), not free', async () => {
    expect(await resolveRunModel(db, 9)).toEqual({ model: '', steps: 0, costMc: null });
  });

  it('a lookup that throws: the cost is UNKNOWN (null), and the failure is reported rather than recorded as a free run', async () => {
    h.fail = true;
    expect(await resolveRunModel(db, 9)).toEqual({ model: '', steps: 0, costMc: null });
    expect(h.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'resolveRunModel' }));
  });

  it('usage rows that really sum to zero (BYO / local) stay a genuine 0', async () => {
    h.rows = [{ model: 'local-model', n: 4, cost: 0 }];
    expect(await resolveRunModel(db, 9)).toEqual({ model: 'local-model', steps: 4, costMc: 0 });
  });

  it('sums the cost and steps across models and names the most-used one', async () => {
    h.rows = [{ model: 'a', n: 5, cost: 700 }, { model: 'b', n: 2, cost: 300 }];
    expect(await resolveRunModel(db, 9)).toEqual({ model: 'a', steps: 7, costMc: 1000 });
  });
});

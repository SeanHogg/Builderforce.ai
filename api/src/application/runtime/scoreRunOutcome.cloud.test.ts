/**
 * The cloud door of the outcome scorer (`scoreRunOutcome`): what a terminal cloud run stores and what it
 * teaches the routing table. One fact per column — `routing_signal` stays "coding-run evidence" — and the
 * fold gate is `foldsIntoRouting`: a run the person STOPPED (`cancelled`) and a run the TENANT's quota ended
 * are stored (and still counted by the lenses), but teach routing nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  /** True = the row already exists (a re-score): the insert conflicts and the scorer updates instead. */
  conflict: false,
  /** True = a turn of the run recorded `weaker: true` on its `llm.complete` event (the scorer's filtered read finds a row). */
  weakerTurn: false,
  exec: { status: 'cancelled', errorMessage: null as string | null },
  applyOutcomeToRoutingTable: vi.fn(async (..._args: unknown[]) => undefined),
  bumpOutcomesVersion: vi.fn(async (..._args: unknown[]) => undefined),
}));

/** A chainable query stub: every builder method returns the chain; awaiting it yields the rows for the table `from` named. */
function queryChain(rowsFor: (table: unknown) => unknown[]) {
  const make = (table?: unknown): unknown => new Proxy(function () { /* callable target */ }, {
    get(_target, prop) {
      if (prop === 'then') {
        const rows = rowsFor(table);
        return (resolve: (value: unknown) => void, reject: (error: unknown) => void) => Promise.resolve(rows).then(resolve, reject);
      }
      if (prop === 'from') return (next: unknown) => make(next);
      return () => make(table);
    },
  });
  return make();
}

vi.mock('../shared/runTelemetryDatabase', () => ({
  runTelemetryDatabase: () => ({
    select: () => queryChain(() => [mocks.weakerTurn ? { id: 5 } : {}]),
    update: () => ({ set: (values: Record<string, unknown>) => { mocks.updated.push(values); return queryChain(() => []); } }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        mocks.inserted.push(row);
        return { onConflictDoNothing: () => ({ returning: async () => (mocks.conflict ? [] : [{ id: mocks.inserted.length }]) }) };
      },
    }),
  }),
}));
vi.mock('../llm/usageLedger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llm/usageLedger')>()),
  resolveUsageDatabase: () => ({ select: () => queryChain(() => [{ model: 'vendor/model', n: 3, cost: 0 }]) }),
  usageDatabaseOf: (db: unknown) => db,
}));
vi.mock('../llm/routingTable', () => ({ applyOutcomeToRoutingTable: mocks.applyOutcomeToRoutingTable }));
vi.mock('../tenant/tenantPlanSnapshot', () => ({ resolveTenantPlan: async () => ({ effectivePlan: 'pro' }) }));
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>()),
  bumpOutcomesVersion: mocks.bumpOutcomesVersion,
}));

const { scoreRunOutcome } = await import('./scoreRunOutcome');
const { executions, tasks } = await import('../../infrastructure/database/schema');

/** The core database the cloud scorer reads the execution and its task from. */
const coreDb = {
  select: () => queryChain((table) => {
    if (table === executions) return [{ status: mocks.exec.status, taskId: 1, tenantId: 7, cloudAgentRef: null, result: '', errorMessage: mocks.exec.errorMessage }];
    if (table === tasks) return [{ projectId: 2, actionType: 'other', title: 't', description: 'd' }];
    return [{}];
  }),
};

const score = (status: string, errorMessage: string | null = null) => {
  mocks.exec.status = status;
  mocks.exec.errorMessage = errorMessage;
  return scoreRunOutcome({} as never, coreDb as never, { executionId: 11 });
};

beforeEach(() => {
  mocks.inserted.length = 0;
  mocks.updated.length = 0;
  mocks.conflict = false;
  mocks.weakerTurn = false;
  mocks.applyOutcomeToRoutingTable.mockClear();
  mocks.bumpOutcomesVersion.mockClear();
});

describe('the cloud scorer — a run the person stopped', () => {
  it('stores it as coding evidence, folds nothing, and still marks the datasets stale', async () => {
    await score('cancelled');

    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0]).toMatchObject({ executionId: 11, terminalStatus: 'cancelled', quotaExhausted: false });
    // `routing_signal` is not touched by the stop: it stays TRUE (coding-run evidence, written explicitly), so
    // the lenses still count the run and a stop rate stays computable.
    expect(mocks.inserted[0]).toMatchObject({ routingSignal: true });
    expect(mocks.applyOutcomeToRoutingTable).not.toHaveBeenCalled();
    expect(mocks.bumpOutcomesVersion).toHaveBeenCalledTimes(1);
  });

  it('does not read a stopped run as a quota failure, whatever its message says', async () => {
    await score('cancelled', 'quota exceeded');

    expect(mocks.inserted[0]).toMatchObject({ terminalStatus: 'cancelled', quotaExhausted: false });
    expect(mocks.applyOutcomeToRoutingTable).not.toHaveBeenCalled();
  });
});

describe('the cloud scorer — a run the tenant’s quota ended', () => {
  it('stores quotaExhausted on the row, folds nothing, and still marks the datasets stale', async () => {
    await score('failed', 'quota exceeded for this workspace');

    expect(mocks.inserted[0]).toMatchObject({ terminalStatus: 'failed', quotaExhausted: true, rateLimited: false });
    expect(mocks.applyOutcomeToRoutingTable).not.toHaveBeenCalled();
    expect(mocks.bumpOutcomesVersion).toHaveBeenCalledTimes(1);
  });
});

describe('the cloud scorer — degraded is read from the turns’ own served-weaker flags', () => {
  it('marks the run degraded when a turn recorded it, and not otherwise', async () => {
    await score('completed');
    expect(mocks.inserted[0]).toMatchObject({ degraded: false });

    mocks.weakerTurn = true;
    await score('completed');
    expect(mocks.inserted[1]).toMatchObject({ degraded: true });
  });
});

describe('the cloud scorer — a re-score keeps the one classification', () => {
  it('refreshes quotaExhausted beside rateLimited, from the same single classification', async () => {
    mocks.conflict = true;
    await score('failed', 'quota exceeded for this workspace');

    expect(mocks.updated[0]).toMatchObject({ quotaExhausted: true, rateLimited: false });
    // A re-score never re-applies the routing increment.
    expect(mocks.applyOutcomeToRoutingTable).not.toHaveBeenCalled();

    await score('failed', 'HTTP 429 too many requests');
    expect(mocks.updated[1]).toMatchObject({ quotaExhausted: false, rateLimited: true });
  });
});

describe('the cloud scorer — every other run still teaches the routing table', () => {
  it('folds a completed run', async () => {
    await score('completed');

    expect(mocks.inserted[0]).toMatchObject({ terminalStatus: 'completed', quotaExhausted: false });
    expect(mocks.applyOutcomeToRoutingTable).toHaveBeenCalledTimes(1);
  });

  it('folds a failed run that is neither a quota nor a stop', async () => {
    await score('failed', 'the build failed');

    expect(mocks.inserted[0]).toMatchObject({ terminalStatus: 'failed', quotaExhausted: false });
    expect(mocks.applyOutcomeToRoutingTable).toHaveBeenCalledTimes(1);
  });

  it('classifies the failure once: a provider rate limit is its own fact, not a quota', async () => {
    await score('failed', 'HTTP 429 too many requests');

    expect(mocks.inserted[0]).toMatchObject({ rateLimited: true, quotaExhausted: false });
  });
});

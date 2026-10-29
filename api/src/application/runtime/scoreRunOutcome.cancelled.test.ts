/**
 * A run the person STOPPED (terminalStatus 'cancelled') says nothing about the model: it is stored,
 * flagged as not routing evidence, and never folded into the routing table as a failure — on the
 * client door (`recordClientRunOutcome`) and on the cloud scorer (`scoreRunOutcome`) alike.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedRunOutcome } from '@builderforce/learned-routing';

const mocks = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  execStatus: 'cancelled' as string,
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
    select: () => queryChain(() => [{}]),
    update: () => queryChain(() => []),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        mocks.inserted.push(row);
        return { onConflictDoNothing: () => ({ returning: async () => [{ id: mocks.inserted.length }] }) };
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

const { scoreRunOutcome, recordClientRunOutcome } = await import('./scoreRunOutcome');
const { executions, tasks } = await import('../../infrastructure/database/schema');

/** The core database the cloud scorer reads the execution and its task from. */
const coreDb = {
  select: () => queryChain((table) => {
    if (table === executions) return [{ status: mocks.execStatus, taskId: 1, tenantId: 7, cloudAgentRef: null, result: '', errorMessage: null }];
    if (table === tasks) return [{ projectId: 2, actionType: 'other', title: 't', description: 'd' }];
    return [{}];
  }),
};

beforeEach(() => {
  mocks.inserted.length = 0;
  mocks.applyOutcomeToRoutingTable.mockClear();
  mocks.bumpOutcomesVersion.mockClear();
});

describe('the cloud scorer — a stopped run', () => {
  it('stores a cancelled run as not routing evidence, and folds nothing', async () => {
    mocks.execStatus = 'cancelled';

    await scoreRunOutcome({} as never, coreDb as never, { executionId: 11 });

    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0]).toMatchObject({ executionId: 11, terminalStatus: 'cancelled', routingSignal: false });
    expect(mocks.applyOutcomeToRoutingTable).not.toHaveBeenCalled();
  });

  it('still teaches the routing table from a run that completed or failed', async () => {
    for (const status of ['completed', 'failed']) {
      mocks.execStatus = status;
      mocks.inserted.length = 0;
      mocks.applyOutcomeToRoutingTable.mockClear();

      await scoreRunOutcome({} as never, coreDb as never, { executionId: 12 });

      expect(mocks.inserted[0]).toMatchObject({ terminalStatus: status, routingSignal: true });
      expect(mocks.applyOutcomeToRoutingTable).toHaveBeenCalledTimes(1);
    }
  });
});

describe('the client door — a stopped run', () => {
  const outcome: NormalizedRunOutcome = { clientRunId: 'ide:1', source: 'ide', model: 'm', terminalStatus: 'cancelled', steps: 3 };

  it('stores a cancelled client run as not routing evidence, and folds nothing', async () => {
    await recordClientRunOutcome({} as never, {} as never, 7, outcome);

    expect(mocks.inserted[0]).toMatchObject({ terminalStatus: 'cancelled', routingSignal: false });
    expect(mocks.applyOutcomeToRoutingTable).not.toHaveBeenCalled();
    expect(mocks.bumpOutcomesVersion).not.toHaveBeenCalled();
  });

  it('still teaches from the same run when it completed', async () => {
    await recordClientRunOutcome({} as never, {} as never, 7, { ...outcome, terminalStatus: 'completed' });

    expect(mocks.inserted[0]).toMatchObject({ terminalStatus: 'completed', routingSignal: true });
    expect(mocks.applyOutcomeToRoutingTable).toHaveBeenCalledTimes(1);
  });
});

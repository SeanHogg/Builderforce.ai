/**
 * A client report that is NOT a routing signal (a Creation Canvas turn) is recorded and goes
 * no further: it is not folded into the routing blob (byAction['other'] and friends stay as
 * they were) and not queued for the datasets. A report without the flag behaves as ever.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NormalizedRunOutcome } from '@builderforce/learned-routing';

const mocks = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  applyOutcomeToRoutingTable: vi.fn(async (..._args: unknown[]) => undefined),
  bumpOutcomesVersion: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock('../shared/runTelemetryDatabase', () => ({
  runTelemetryDatabase: () => ({
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        mocks.inserted.push(row);
        return { onConflictDoNothing: () => ({ returning: async () => [{ id: mocks.inserted.length }] }) };
      },
    }),
  }),
}));
vi.mock('../llm/routingTable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llm/routingTable')>()),
  applyOutcomeToRoutingTable: mocks.applyOutcomeToRoutingTable,
}));
vi.mock('../tenant/tenantPlanSnapshot', () => ({ resolveTenantPlan: async () => ({ effectivePlan: 'pro' }) }));
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>()),
  bumpOutcomesVersion: mocks.bumpOutcomesVersion,
}));

const { recordClientRunOutcome } = await import('./scoreRunOutcome');

const base: NormalizedRunOutcome = { clientRunId: 'canvas:1', source: 'external', model: 'm', terminalStatus: 'completed', steps: 3, entryPoint: 'canvas' };
const record = (outcome: NormalizedRunOutcome) => recordClientRunOutcome({} as never, {} as never, 7, outcome);

beforeEach(() => {
  mocks.inserted.length = 0;
  mocks.applyOutcomeToRoutingTable.mockClear();
  mocks.bumpOutcomesVersion.mockClear();
});

describe('recordClientRunOutcome — routingSignal', () => {
  it('records a canvas report as telemetry only: stored, flagged, never folded into the routing blob', async () => {
    await record({ ...base, routingSignal: false });

    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0]).toMatchObject({ tenantId: 7, clientRunId: 'canvas:1', entryPoint: 'canvas', routingSignal: false });
    expect(mocks.applyOutcomeToRoutingTable).not.toHaveBeenCalled();
    expect(mocks.bumpOutcomesVersion).not.toHaveBeenCalled();
  });

  it('a report without the flag teaches the routing table exactly as before', async () => {
    await record({ clientRunId: 'ide-1', source: 'ide', model: 'm', terminalStatus: 'completed' });

    expect(mocks.inserted[0]).toMatchObject({ routingSignal: true });
    expect(mocks.applyOutcomeToRoutingTable).toHaveBeenCalledTimes(1);
  });
});

/**
 * POST /v1/run-outcome carries the PRD 35 §8.2 uniform row (the canvas, and any other
 * non-cloud entry point, reports it here). Two promises:
 *   1. a body WITH the row's fields reaches the application use case normalized — entry
 *      point, counters, verify, trips — scoped to the caller's tenant;
 *   2. a legacy body (none of the new fields) reaches it exactly as it always did.
 * The route owns no table: it validates through the shared contract and hands the outcome
 * to `recordClientRunOutcome`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  recordClientRunOutcome: vi.fn(async () => undefined),
  requireTenantAccess: vi.fn(async () => ({ tenantId: 7 })),
  taskInTenant: vi.fn(async (_db: unknown, taskId: number, _tenantId: number) => taskId === 31),
  projectInTenantCached: vi.fn(async (_env: unknown, _db: unknown, _tenantId: number, projectId: number) => projectId === 12),
  projectInTenant: vi.fn(async (_db: unknown, _tenantId: number, projectId: number) => projectId === 12),
}));

vi.mock('../../../application/runtime/scoreRunOutcome', () => ({ recordClientRunOutcome: mocks.recordClientRunOutcome }));
vi.mock('../../../application/project/projectOwnership', () => ({ projectInTenant: mocks.projectInTenant, projectInTenantCached: mocks.projectInTenantCached }));
vi.mock('../../../infrastructure/database/tenantScope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../infrastructure/database/tenantScope')>()),
  taskInTenant: mocks.taskInTenant,
}));
vi.mock('../../../application/shared/dbHandle', () => ({ requestDb: () => ({}) }));
vi.mock('./access', () => ({
  requireTenantAccess: mocks.requireTenantAccess,
  respondToAccessError: (c: { json: (b: unknown, s: number) => Response }, err: Error) => c.json({ error: err.message }, 401),
}));

const { mountLearnedRoutingRoutes } = await import('./learnedRoutingRoutes');

function app() {
  const router = new Hono();
  mountLearnedRoutingRoutes(router as never);
  return router;
}

async function post(body: unknown) {
  return app().request('http://test.local/v1/run-outcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, {});
}

beforeEach(() => mocks.recordClientRunOutcome.mockClear());

describe('POST /v1/run-outcome — the uniform outcome row', () => {
  it('round-trips a canvas row: the request the client builds is the outcome the use case records', async () => {
    // The body the canvas host sends: the row's own field names beside the routing fields.
    const request = {
      clientRunId: 'canvas:run-1', model: 'minimaxai/minimax-m3', source: 'external', terminalStatus: 'completed', steps: 4,
      projectId: 12, routingSignal: false,
      entryPoint: 'canvas', toolCalls: 3, toolErrors: 1, compactions: 0, stallRecoveries: 2, escalations: 0, verify: 'not-run',
      firstSpawnTurn: null, coveredReadStubs: 0, modelPreflight: 'ok', progressTrips: { circling_read: 1 },
    };

    const res = await post(request);

    expect(res.status).toBe(200);
    expect(mocks.recordClientRunOutcome).toHaveBeenCalledTimes(1);
    const [, , tenantId, outcome] = mocks.recordClientRunOutcome.mock.calls[0] as unknown as [unknown, unknown, number, Record<string, unknown>];
    expect(tenantId).toBe(7);
    expect(outcome).toMatchObject({
      clientRunId: 'canvas:run-1', model: 'minimaxai/minimax-m3', source: 'external', terminalStatus: 'completed', steps: 4,
      entryPoint: 'canvas', projectId: 12, routingSignal: false, toolCalls: 3, toolErrors: 1, compactions: 0, stallRecoveries: 2, escalations: 0,
      verify: 'not-run', coveredReadStubs: 0, modelPreflight: 'ok', progressTrips: { circling_read: 1 },
    });
    // A null first-spawn turn is "nothing was spawned", and travels as such.
    expect(outcome).toMatchObject({ firstSpawnTurn: null });
  });

  it('drops a field it cannot read without refusing the report', async () => {
    const res = await post({ clientRunId: 'r', model: 'm', entryPoint: 'mainframe', compactions: -3, verify: 'maybe', progressTrips: { a: 'x', b: 2 }, toolCalls: 4 });

    expect(res.status).toBe(200);
    const outcome = (mocks.recordClientRunOutcome.mock.calls[0] as unknown as [unknown, unknown, number, Record<string, unknown>])[3];
    expect(outcome).not.toHaveProperty('entryPoint');
    expect(outcome).not.toHaveProperty('compactions');
    expect(outcome).not.toHaveProperty('verify');
    // A malformed map is a missing fact, whole; a good field beside it survives.
    expect(outcome).not.toHaveProperty('progressTrips');
    expect(outcome).toMatchObject({ toolCalls: 4 });
  });

  it('leaves a legacy body exactly as it was: none of the new fields appear', async () => {
    const res = await post({ clientRunId: 'ide-1', model: 'claude-opus-5', source: 'ide', role: 'code', terminalStatus: 'failed', merged: false, steps: 12 });

    expect(res.status).toBe(200);
    const outcome = (mocks.recordClientRunOutcome.mock.calls[0] as unknown as [unknown, unknown, number, Record<string, unknown>])[3];
    expect(outcome).toEqual({
      clientRunId: 'ide-1', model: 'claude-opus-5', source: 'ide', role: 'code', terminalStatus: 'failed', merged: false, steps: 12,
    });
  });

  it('files a report under a project the caller’s tenant owns, and unscoped otherwise', async () => {
    await post({ clientRunId: 'own', model: 'm', projectId: 12 });
    await post({ clientRunId: 'foreign', model: 'm', projectId: 99 });

    const outcomes = mocks.recordClientRunOutcome.mock.calls.map((call) => (call as unknown as [unknown, unknown, number, Record<string, unknown>])[3]);
    expect(outcomes[0]).toMatchObject({ clientRunId: 'own', projectId: 12 });
    expect(outcomes[1]).toMatchObject({ clientRunId: 'foreign' });
    expect(outcomes[1]).not.toHaveProperty('projectId');
    expect(mocks.projectInTenantCached).toHaveBeenCalledWith(expect.anything(), expect.anything(), 7, 99);
  });

  it('files a report under a ticket the caller’s tenant owns, and without one otherwise', async () => {
    await post({ clientRunId: 'own', model: 'm', taskId: 31 });
    await post({ clientRunId: 'foreign', model: 'm', taskId: 77 });

    const outcomes = mocks.recordClientRunOutcome.mock.calls.map((call) => (call as unknown as [unknown, unknown, number, Record<string, unknown>])[3]);
    expect(outcomes[0]).toMatchObject({ clientRunId: 'own', taskId: 31 });
    expect(outcomes[1]).not.toHaveProperty('taskId');
    expect(mocks.taskInTenant).toHaveBeenCalledWith(expect.anything(), 77, 7);
  });

  it('still refuses a body with nothing to key on', async () => {
    const res = await post({ model: 'm' });

    expect(res.status).toBe(400);
    expect(mocks.recordClientRunOutcome).not.toHaveBeenCalled();
  });
});

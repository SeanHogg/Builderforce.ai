/**
 * PRD 09 D6 / D8 through `dispatchCloudRunForTask` / `startDispatchedExecution`: the
 * choke point every cloud run funnels through. Admission itself is covered in
 * dispatchAdmission.test.ts; here only WHERE it is applied and what each caller is told.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

const preAdmitRun = vi.fn();
const admitCloudRun = vi.fn();
const recordCloudToolEvent = vi.fn(async (..._a: unknown[]) => undefined);
const recordAutoRunSkip = vi.fn(async (..._a: unknown[]) => undefined);
const ensureTaskPrd = vi.fn(async (..._a: unknown[]) => '# prd');

vi.mock('./dispatchAdmission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dispatchAdmission')>();
  return { ...actual, preAdmitRun: (...a: unknown[]) => preAdmitRun(...a), admitCloudRun: (...a: unknown[]) => admitCloudRun(...a) };
});
vi.mock('./cloudAgentEngine', () => ({
  markCloudExecutionRunning: async () => undefined,
  recordCloudToolEvent: (...a: unknown[]) => recordCloudToolEvent(...a),
  resolveCloudAgent: async () => ({ ref: 'agent-1', label: 'Ada', engine: 'v2', active: true, runtimeSupport: 'both', runtimeSurface: 'durable', baseModel: 'm' }),
  agentAllowsHostExecution: () => true,
}));
vi.mock('./cloudAgent/prd', () => ({ ensureTaskPrd: (...a: unknown[]) => ensureTaskPrd(...a) }));
vi.mock('../tenant/featureEntitlements', () => ({ tenantHasFeature: async () => false }));
vi.mock('../repos/resolveDefaultRepo', () => ({ resolveDefaultRepoForTask: async () => null, resolveDefaultRepoForProject: async () => null }));
vi.mock('../artifact/resolveArtifacts', () => ({ resolveArtifacts: async () => undefined }));
vi.mock('./executionEvents', () => ({ notifyExecutionSubscribers: () => undefined }));
vi.mock('./defaultCloudAgent', () => ({ resolveDefaultCloudAgentRef: async () => ({ ref: null, reason: 'none' }), UNATTRIBUTED_RUN_MESSAGE: { none: 'x' } }));
vi.mock('./cloudRunLedger', () => ({ enforceCloudRunCap: async () => ({ allowed: true }) }));
vi.mock('./githubActionsDispatch', () => ({ dispatchGithubActionsRun: vi.fn(), githubActionsAvailable: async () => false }));
vi.mock('../llm/projectEvermind', () => ({ resolveProjectInferenceModel: async () => undefined }));
vi.mock('./agentExecutionGate', () => ({ agentExecutionEnabledCached: async () => true }));
vi.mock('../kanban/managedExecutionGuard', () => ({ authorizeManagedTaskExecution: async () => ({ allowed: true }) }));
vi.mock('./autoRunSkipLedger', () => ({
  recordAutoRunSkip: (...a: unknown[]) => recordAutoRunSkip(...a),
  clearAutoRunSkip: async () => undefined,
}));

const { dispatchCloudRunForTask } = await import('./dispatchCloudRun');
const { dispatchToAgentHost } = await import('./hostDelivery');
const { withAdmissionRefusal } = await import('./dispatchAdmission');

const dedupe = { code: 'execution_already_live', taskId: 42, executionId: 7, status: 'running', message: 'This task already has a live run (execution 7, running).' } as const;
const capped = { code: 'concurrent_run_limit', limit: 2, current: 2, effectivePlan: 'free', message: 'This workspace already has 2 of 2 cloud runs in flight.' } as const;
const refusedResult = (r: typeof capped | typeof dedupe) => withAdmissionRefusal({ id: 99, status: 'cancelled' }, r);

function makeDb(task: { assignedAgentHostId: number | null }): Db {
  const taskRow = {
    id: 42, title: 'T', description: null, assignedAgentRef: 'agent-1', assignedUserId: null,
    status: 'todo', priority: 'medium', projectId: 2, ...task,
  };
  return {
    select: (fields: Record<string, unknown>) => {
      const rows = 'title' in fields ? [taskRow] : [{ id: 7 }];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where', 'limit', 'orderBy']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
      return chain;
    },
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as Db;
}

function makeRuntime() {
  const execution = { id: 99, status: 'pending', toPlain: () => ({ id: 99, status: 'pending' }) };
  const failed = { id: 99, status: 'failed', toPlain: () => ({ id: 99, status: 'failed' }) };
  return {
    submit: vi.fn(async () => execution),
    getExecution: vi.fn(async () => failed),
    update: vi.fn(async () => failed),
    listByTask: vi.fn(async () => []),
  };
}

const relayReturning = (response: () => Response) => ({ AGENT_HOST_RELAY: { idFromName: (n: string) => n, get: () => ({ fetch: async () => response() }) } });

const call = (db: Db, runtime: ReturnType<typeof makeRuntime>, over: Record<string, unknown> = {}, env: unknown = {}) =>
  dispatchCloudRunForTask(env as never, db, runtime as never, () => undefined, { taskId: 42, tenantId: 1, submittedBy: 'system:lane-auto', ...over });

beforeEach(() => {
  preAdmitRun.mockReset().mockResolvedValue(null);
  admitCloudRun.mockReset().mockResolvedValue(null);
  recordCloudToolEvent.mockClear();
  recordAutoRunSkip.mockClear();
  ensureTaskPrd.mockClear();
});

describe('dispatchCloudRunForTask admission', () => {
  it('regression: an autonomous dedupe refusal is `deferred`, creates no run and is recorded as already_running', async () => {
    preAdmitRun.mockResolvedValue(dedupe);
    const runtime = makeRuntime();
    const out = await call(makeDb({ assignedAgentHostId: null }), runtime);
    expect(out).toMatchObject({ executionId: null, deferred: true, refusal: { reason: 'already_running' } });
    expect(runtime.submit).not.toHaveBeenCalled(); // no failed row for the circuit breaker to count
    expect(recordAutoRunSkip).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ reason: 'already_running', stateDiscriminator: 7 }));
  });

  it('regression: an autonomous cap refusal is `deferred`, not a failed run', async () => {
    preAdmitRun.mockResolvedValue(capped);
    const runtime = makeRuntime();
    const out = await call(makeDb({ assignedAgentHostId: null }), runtime);
    expect(out).toMatchObject({ executionId: null, deferred: true, refusal: { reason: 'concurrent_run_limit' } });
    expect(runtime.submit).not.toHaveBeenCalled();
    expect(runtime.update).not.toHaveBeenCalled();
  });

  it('regression: Run-now (force) is gated too, and is told the refusal without the `deferred` flag', async () => {
    preAdmitRun.mockResolvedValue(capped);
    const out = await call(makeDb({ assignedAgentHostId: null }), makeRuntime(), { force: true });
    expect(out.executionId).toBeNull();
    expect(out.refusal?.reason).toBe('concurrent_run_limit');
    expect(out.deferred).toBeUndefined();
  });

  it('regression: a cloud run refused after its row exists is admitted BEFORE the ticket claim and PRD draft', async () => {
    admitCloudRun.mockResolvedValue(refusedResult(capped));
    const out = await call(makeDb({ assignedAgentHostId: null }), makeRuntime());
    expect(out).toMatchObject({ executionId: null, deferred: true, refusal: { reason: 'concurrent_run_limit' } });
    expect(admitCloudRun.mock.calls[0]![3]).toMatchObject({ taskId: 42, executionId: 99, cloudBound: true });
    expect(ensureTaskPrd).not.toHaveBeenCalled();
  });

  it('regression: a pinned host that is offline is admitted as host-bound first, then gated and counted as a cloud run', async () => {
    const out = await call(makeDb({ assignedAgentHostId: 7 }), makeRuntime(), { force: true });
    expect(preAdmitRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ checkCap: false }));
    expect(admitCloudRun).toHaveBeenCalledTimes(2);
    expect(admitCloudRun.mock.calls[0]![3]).toMatchObject({ cloudBound: false }); // dedupe only, before delivery
    expect(admitCloudRun.mock.calls[1]![3]).toMatchObject({ cloudBound: true, executionId: 99 }); // the fallback is a cloud run
    expect(out.executionId).toBe(99);
  });

  it('regression: a pinned host that falls back to a full cloud is refused, and never started', async () => {
    admitCloudRun.mockResolvedValueOnce(null).mockResolvedValueOnce(refusedResult(capped));
    const out = await call(makeDb({ assignedAgentHostId: 7 }), makeRuntime());
    expect(out).toMatchObject({ executionId: null, deferred: true, refusal: { reason: 'concurrent_run_limit' } });
  });

  it('regression: a host-delivered duplicate is refused by the per-task dedupe before delivery', async () => {
    admitCloudRun.mockResolvedValueOnce(refusedResult(dedupe));
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const env = { AGENT_HOST_RELAY: { idFromName: (n: string) => n, get: () => ({ fetch }) } };
    const out = await call(makeDb({ assignedAgentHostId: 7 }), makeRuntime(), { force: true }, env);
    expect(out.refusal?.reason).toBe('already_running');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a delivered host run is deduped but not held to the cloud cap', async () => {
    const env = relayReturning(() => new Response('{}', { status: 200 }));
    const out = await call(makeDb({ assignedAgentHostId: 7 }), makeRuntime(), { force: true }, env);
    expect(admitCloudRun).toHaveBeenCalledTimes(1);
    expect(admitCloudRun.mock.calls[0]![3]).toMatchObject({ cloudBound: false });
    expect(out.executionId).toBe(99);
  });

  it('regression: a relay-rejected (400) dispatch frame is recorded on the run, not dropped silently', async () => {
    const env = relayReturning(() => new Response(JSON.stringify({ ok: false, error: 'task_required' }), { status: 400 }));
    await call(makeDb({ assignedAgentHostId: 7 }), makeRuntime(), { force: true }, env);
    expect(recordCloudToolEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      toolName: 'runtime.host_frame_rejected', category: 'error', detail: expect.objectContaining({ reason: 'task_required' }),
    }));
    expect(admitCloudRun).toHaveBeenCalledTimes(2); // and the run still falls back to the cloud, gated
  });
});

describe('dispatchToAgentHost', () => {
  const frame = { type: 'task.assign', executionId: 1, taskId: 2, task: { title: 't' } } as const;

  it('reports a 400 rejection reason through onRejected and returns false', async () => {
    const onRejected = vi.fn();
    const env = relayReturning(() => new Response(JSON.stringify({ ok: false, error: 'execution_id_invalid' }), { status: 400 }));
    expect(await dispatchToAgentHost(env as never, 3, frame, onRejected)).toBe(false);
    expect(onRejected).toHaveBeenCalledWith('execution_id_invalid');
  });

  it('an offline host (409) is not a rejection', async () => {
    const onRejected = vi.fn();
    const env = relayReturning(() => new Response('{}', { status: 409 }));
    expect(await dispatchToAgentHost(env as never, 3, frame, onRejected)).toBe(false);
    expect(onRejected).not.toHaveBeenCalled();
  });
});

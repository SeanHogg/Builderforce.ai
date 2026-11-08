/**
 * PRD 09 D6 / D8 for a follow-up run (Send on a finished run, a late steer): gated before
 * a row exists, and again after the row exists when the choke point refuses it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from './RuntimeService';

const preAdmitRun = vi.fn();
const startDispatchedExecution = vi.fn();
const submit = vi.fn(async () => ({ id: 901, status: 'pending', toPlain: () => ({}) }));

vi.mock('../llm/tenantTokenAvailability', () => ({ checkTenantTokenGate: async () => null }));
vi.mock('./cloudRunLedger', () => ({ enforceCloudRunCap: async () => ({ allowed: true }) }));
vi.mock('./executionApprovalGate', () => ({ evaluateExecutionApprovalGate: async () => ({ allowed: true }) }));
vi.mock('./dispatchCloudRun', () => ({ startDispatchedExecution: (...a: unknown[]) => startDispatchedExecution(...a) }));
vi.mock('./dispatchAdmission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dispatchAdmission')>();
  return { ...actual, preAdmitRun: (...a: unknown[]) => preAdmitRun(...a) };
});
// The real dispatchAdmission (kept for its pure helpers) pulls these in; stub them so the
// import graph does not reach the cloud engine.
vi.mock('./autoRunSkipLedger', () => ({ recordAutoRunSkip: async () => undefined }));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: async () => undefined }));
vi.mock('./executionEvents', () => ({ notifyExecutionSubscribers: () => undefined }));
vi.mock('./deferredDispatch', () => ({ parkDeferredDispatch: async () => undefined }));
vi.mock('./concurrentRunCap', () => ({
  enforceConcurrentRunCap: async () => ({ allowed: true }),
  liveCloudExecutionIds: async () => [],
  resolveConcurrentRunLimit: async () => ({ limit: null }),
}));
vi.mock('./executionSteering', () => ({ enqueueExecutionMessage: async () => 1 }));
vi.mock('./cloudAgent/prd', () => ({ recordPrdDirective: async () => undefined }));
vi.mock('../swimlane/evaluateAutoRun', () => ({ AUTO_RUN_REASON_TEXT: { cloud_run_limit: 'x' } }));
vi.mock('./cloudDispatch', () => ({ buildFollowUpPayload: () => '{}', withExecutor: (p: string) => p }));

import { startFollowUpRun, type FollowUpRunArgs } from './followUpRun';
import { withAdmissionRefusal } from './dispatchAdmission';

const dedupe = { code: 'execution_already_live', taskId: 11, executionId: 5, status: 'running', message: 'live run' } as const;
const capped = { code: 'concurrent_run_limit', limit: 2, current: 2, effectivePlan: 'free', message: 'cap' } as const;

const runtimeService = { submit } as unknown as RuntimeService;
const args = (over: Partial<FollowUpRunArgs['prior']> = {}, taskHost: number | null = null): FollowUpRunArgs => ({
  tenantId: 7,
  prior: { id: 42, payload: '{}', agentHostId: null, source: 'agent', ...over },
  taskRow: { id: 11, title: 'T', description: null, assignedAgentHostId: taskHost, assignedAgentRef: 'bob', assignedUserId: null, priority: 'medium', projectId: 3 },
  directive: 'do more',
  submittedBy: 'user-ada',
  agentLabel: 'Bob',
});

beforeEach(() => {
  preAdmitRun.mockReset().mockResolvedValue(null);
  startDispatchedExecution.mockReset().mockResolvedValue({ dispatched: true });
  submit.mockClear();
});

describe('startFollowUpRun admission', () => {
  it('regression: a follow-up onto a ticket with a live run is refused before any row exists', async () => {
    preAdmitRun.mockResolvedValue(dedupe);
    const out = await startFollowUpRun({} as Env, {} as Db, runtimeService, () => undefined, args());
    expect(out).toMatchObject({ kind: 'refused', reason: 'execution_already_live', admission: dedupe });
    expect(submit).not.toHaveBeenCalled();
  });

  it('regression: a follow-up over the concurrent cap is refused', async () => {
    preAdmitRun.mockResolvedValue(capped);
    const out = await startFollowUpRun({} as Env, {} as Db, runtimeService, () => undefined, args());
    expect(out).toMatchObject({ kind: 'refused', reason: 'concurrent_run_limit' });
  });

  it('regression: a follow-up that loses the post-insert race is refused, not reported as started', async () => {
    startDispatchedExecution.mockResolvedValue(withAdmissionRefusal({ id: 901, status: 'failed' }, capped));
    const out = await startFollowUpRun({} as Env, {} as Db, runtimeService, () => undefined, args());
    expect(out).toMatchObject({ kind: 'refused', reason: 'concurrent_run_limit', admission: capped });
  });

  it('the pinned-host shortcut skips only the optimistic cap look, never the dedupe', async () => {
    await startFollowUpRun({} as Env, {} as Db, runtimeService, () => undefined, args({ agentHostId: 3 }));
    expect(preAdmitRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ taskId: 11, checkCap: false, actingUserId: 'user-ada' }));
  });

  it('an admitted follow-up starts and carries the acting user to the choke point', async () => {
    const out = await startFollowUpRun({} as Env, {} as Db, runtimeService, () => undefined, args());
    expect(out).toMatchObject({ kind: 'started', executionId: 901 });
    expect(startDispatchedExecution.mock.calls[0]![8]).toMatchObject({ actingUserId: 'user-ada' });
  });
});

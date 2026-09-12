/**
 * The ONE follow-up machinery ("Send" on a finished run, `chats.execute_as_agent`, and a
 * steer that missed its run's last turn). Pins the order that makes a refusal honest:
 * billing entitlements refuse BEFORE a row or an approval exists.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from './RuntimeService';

const h = vi.hoisted(() => ({
  tokenBlock: null as null | { error: string },
  cap: { allowed: true, used: 3, limit: 50, effectivePlan: 'pro' } as { allowed: boolean; used: number; limit: number; effectivePlan: string },
  gate: { allowed: true } as { allowed: true } | { allowed: false; approvalId: string; status: 'pending'; reason: string },
}));

const checkTenantTokenGate = vi.fn(async () => h.tokenBlock);
const enforceCloudRunCap = vi.fn(async () => h.cap);
const evaluateExecutionApprovalGate = vi.fn(async () => h.gate);
const startDispatchedExecution = vi.fn(async () => ({ dispatched: true }));
const enqueueExecutionMessage = vi.fn(async () => 1);
const recordPrdDirective = vi.fn(async () => undefined);

vi.mock('../llm/tenantTokenAvailability', () => ({ checkTenantTokenGate: (...a: unknown[]) => checkTenantTokenGate(...(a as [])) }));
vi.mock('./cloudRunLedger', () => ({ enforceCloudRunCap: (...a: unknown[]) => enforceCloudRunCap(...(a as [])) }));
vi.mock('./executionApprovalGate', () => ({ evaluateExecutionApprovalGate: (...a: unknown[]) => evaluateExecutionApprovalGate(...(a as [])) }));
vi.mock('./dispatchCloudRun', () => ({ startDispatchedExecution: (...a: unknown[]) => startDispatchedExecution(...(a as [])) }));
vi.mock('./executionSteering', () => ({ enqueueExecutionMessage: (...a: unknown[]) => enqueueExecutionMessage(...(a as [])) }));
vi.mock('./cloudAgent/prd', () => ({ recordPrdDirective: (...a: unknown[]) => recordPrdDirective(...(a as [])) }));
vi.mock('../swimlane/evaluateAutoRun', () => ({ AUTO_RUN_REASON_TEXT: { cloud_run_limit: 'No run: this workspace has used its monthly cloud-run allowance.' } }));
vi.mock('./cloudDispatch', () => ({
  buildFollowUpPayload: (prior: string | null, f: { directive: string; priorExecutionId: number }) =>
    JSON.stringify({ ...(prior ? JSON.parse(prior) as object : {}), followUp: f }),
}));

import { startFollowUpRun, type FollowUpRunArgs } from './followUpRun';

const submit = vi.fn(async () => ({ id: 901, status: 'pending', toPlain: () => ({}) }));
const runtimeService = { submit } as unknown as RuntimeService;
const env = {} as Env;
const db = {} as Db;

function args(over: Partial<FollowUpRunArgs> = {}): FollowUpRunArgs {
  return {
    tenantId: 7,
    prior: { id: 42, payload: JSON.stringify({ cloudAgentRef: 'bob', model: 'm' }), agentHostId: null, source: 'agent' },
    taskRow: { id: 11, title: 'T', description: null, assignedAgentHostId: null, assignedAgentRef: 'bob', assignedUserId: null, priority: 'medium', projectId: 3 },
    directive: 'also update the README',
    submittedBy: 'user-ada',
    agentLabel: 'Bob',
    ...over,
  };
}

beforeEach(() => {
  h.tokenBlock = null;
  h.cap = { allowed: true, used: 3, limit: 50, effectivePlan: 'pro' };
  h.gate = { allowed: true };
  for (const m of [checkTenantTokenGate, enforceCloudRunCap, evaluateExecutionApprovalGate, startDispatchedExecution, enqueueExecutionMessage, recordPrdDirective, submit]) m.mockClear();
});

describe('startFollowUpRun', () => {
  it('starts the follow-up AS the prior run (same agent/model pin + the directive), under the person directing it', async () => {
    const out = await startFollowUpRun(env, db, runtimeService, () => undefined, args());

    expect(out).toEqual({ kind: 'started', executionId: 901, dispatch: { dispatched: true } });
    expect(checkTenantTokenGate).toHaveBeenCalledWith(db, 7, { actingUserId: 'user-ada' }, env);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ taskId: 11, tenantId: 7, submittedBy: 'user-ada', source: 'agent' }));
    const payload = JSON.parse((submit.mock.calls[0] as unknown as [{ payload: string }])[0].payload) as Record<string, unknown>;
    expect(payload).toMatchObject({ cloudAgentRef: 'bob', model: 'm', followUp: { directive: 'also update the README', priorExecutionId: 42 } });
    // Display-only echo: the directive is already the run's headline instruction.
    expect(enqueueExecutionMessage).toHaveBeenCalledWith(db, expect.objectContaining({ executionId: 901, pending: false, sentBy: 'user-ada' }));
  });

  it('a token-allowance refusal starts nothing — no approval opened, no row created', async () => {
    h.tokenBlock = { error: 'Monthly AI spend cap reached for this seat ($5.00).' };

    const out = await startFollowUpRun(env, db, runtimeService, () => undefined, args());

    expect(out).toEqual({ kind: 'refused', reason: 'tenant_token_limit', message: 'Monthly AI spend cap reached for this seat ($5.00).' });
    expect(evaluateExecutionApprovalGate).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('the cloud-run cap refuses a cloud-bound follow-up, but never one pinned to an on-prem host', async () => {
    h.cap = { allowed: false, used: 50, limit: 50, effectivePlan: 'free' };

    const cloud = await startFollowUpRun(env, db, runtimeService, () => undefined, args());
    expect(cloud).toMatchObject({ kind: 'refused', reason: 'cloud_run_limit' });
    expect((cloud as { message: string }).message).toContain('50/50');
    expect(submit).not.toHaveBeenCalled();

    enforceCloudRunCap.mockClear();
    const onPrem = await startFollowUpRun(env, db, runtimeService, () => undefined, args({
      prior: { id: 42, payload: null, agentHostId: 5, source: 'agent' },
    }));
    expect(onPrem.kind).toBe('started');
    expect(enforceCloudRunCap).not.toHaveBeenCalled();
  });

  it('a governance gate holds the follow-up for approval (over the follow-up payload) and creates no row', async () => {
    h.gate = { allowed: false, approvalId: 'ap_1', status: 'pending', reason: 'Task priority requires manager approval before execution.' };

    const out = await startFollowUpRun(env, db, runtimeService, () => undefined, args());

    expect(out).toEqual({ kind: 'awaiting_approval', approvalId: 'ap_1', reason: 'Task priority requires manager approval before execution.' });
    const gateArgs = evaluateExecutionApprovalGate.mock.calls[0] as unknown as [unknown, number, string, unknown, unknown, { payload: string }];
    expect(JSON.parse(gateArgs[5].payload)).toMatchObject({ followUp: { priorExecutionId: 42 } });
    expect(submit).not.toHaveBeenCalled();
  });
});

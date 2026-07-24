import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CloudRunnerDO — the two direct-write lifecycle sites that bypass
 * RuntimeService.update and therefore MUST narrate into the linked Brain chats
 * themselves ("human driving the chat is notified on execution"):
 *
 *   • ask_human pause: the alarm tick that parks the run in `paused` posts a
 *     `paused` milestone carrying the QUESTION + the approval id (idempotency
 *     nonce, one narration per Q&A cycle).
 *   • /resume: the only authoritative "actually resumed" point (a wake with no
 *     cursor 409s) posts a `resumed` milestone keyed by the answered approval id
 *     threaded from approvalRoutes → resumePausedExecution → the DO body.
 */

const h = vi.hoisted(() => ({
  milestoneCalls: [] as Array<{ executionId: number; phase: string; opts?: Record<string, unknown> }>,
  updateCalls: [] as Array<Record<string, unknown>>,
  markRunningCalls: [] as number[],
  loopResult: null as Record<string, unknown> | null,
}));

vi.mock('../database/connection', () => ({
  buildDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ status: 'running' }] }) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: () => { h.updateCalls.push(v); return Promise.resolve([]); } }) }),
  }),
}));
vi.mock('../../buildRuntimeService', () => ({
  buildRuntimeService: () => ({
    update: vi.fn(async () => ({})),
    postLifecycleMilestoneById: vi.fn(async (executionId: number, phase: string, opts?: Record<string, unknown>) => {
      h.milestoneCalls.push({ executionId, phase, opts });
    }),
  }),
}));
vi.mock('../../application/runtime/cloudAgentEngine', () => ({
  prepareCloudRun: vi.fn(),
  runCloudToolLoop: vi.fn(async () => h.loopResult),
  markCloudExecutionRunning: vi.fn(async (_svc: unknown, id: number) => { h.markRunningCalls.push(id); }),
  initialCloudLimbicState: vi.fn(() => ({})),
  evolveCloudLimbicState: vi.fn((s: unknown) => s),
  recordLimbicState: vi.fn(async () => {}),
}));
vi.mock('../../application/artifact/capabilityContext', () => ({ loadPersonaSetpoints: vi.fn(async () => ({})) }));
vi.mock('../../application/runtime/scoreRunOutcome', () => ({ scoreRunOutcome: vi.fn(async () => {}) }));
vi.mock('../../application/runtime/executionSteering', () => ({ releasePendingSteers: vi.fn(async () => {}) }));
vi.mock('../../application/runtime/cloudDispatch', () => ({ parseRoutingBias: () => null, parsePolicyGates: () => null }));
vi.mock('@builderforce/agent-tools', () => ({ buildLimbicBlock: () => '' }));

import { CloudRunnerDO } from './CloudRunnerDO';

const EXEC_ID = 88;

function makeState() {
  const storage = new Map<string, unknown>();
  return {
    storage: {
      get: async (k: string) => storage.get(k),
      put: async (k: string, v: unknown) => { storage.set(k, v); },
      delete: async (k: string) => storage.delete(k),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
  };
}

function loopCursor() {
  return {
    stage: 'loop', executionId: EXEC_ID, tenantId: 1, projectId: 2, taskId: 7,
    taskTitle: 'ticket', taskDescription: null, agentLabel: 'Dev Agent', limbic: false,
  };
}

function makeDo() {
  const state = makeState();
  const runner = new CloudRunnerDO(state as never, {} as never);
  return { runner, state };
}

beforeEach(() => {
  h.milestoneCalls.length = 0;
  h.updateCalls.length = 0;
  h.markRunningCalls.length = 0;
  h.loopResult = null;
});

describe('CloudRunnerDO lifecycle narration', () => {
  it('narrates the ask_human PAUSE with the question, keyed by the approval id', async () => {
    const { runner, state } = makeDo();
    await state.storage.put('cursor', loopCursor());
    h.loopResult = {
      ok: false, output: '', cancelled: false, finished: false, state: { step: 3 },
      awaitingInput: { approvalId: 'appr-9', question: 'Which environment should I deploy to?' },
    };

    await runner.alarm();

    // The row was parked in paused…
    expect(h.updateCalls.some((u) => u.status === 'paused')).toBe(true);
    // …and the pause reached the linked chats WITH the question + per-cycle nonce.
    expect(h.milestoneCalls).toEqual([{
      executionId: EXEC_ID, phase: 'paused',
      opts: { questionText: 'Which environment should I deploy to?', eventNonce: 'appr-9' },
    }]);
  });

  it('narrates RESUME on /resume, keyed by the answered approval threaded from the answer', async () => {
    const { runner, state } = makeDo();
    await state.storage.put('cursor', loopCursor());

    const res = await runner.fetch(new Request('https://cloud-runner/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId: 'appr-9' }),
    }));

    expect(res.status).toBe(202);
    expect(h.markRunningCalls).toEqual([EXEC_ID]);
    expect(h.milestoneCalls).toEqual([
      { executionId: EXEC_ID, phase: 'resumed', opts: { eventNonce: 'appr-9' } },
    ]);
  });

  it('still narrates RESUME (nonce-less) when no approval id was threaded', async () => {
    const { runner, state } = makeDo();
    await state.storage.put('cursor', loopCursor());

    await runner.fetch(new Request('https://cloud-runner/resume', { method: 'POST' }));

    expect(h.milestoneCalls).toEqual([
      { executionId: EXEC_ID, phase: 'resumed', opts: { eventNonce: null } },
    ]);
  });

  it('does NOT narrate resume on a wake with no paused cursor (409 — nothing actually resumed)', async () => {
    const { runner } = makeDo();
    const res = await runner.fetch(new Request('https://cloud-runner/resume', { method: 'POST' }));
    expect(res.status).toBe(409);
    expect(h.milestoneCalls).toHaveLength(0);
    expect(h.markRunningCalls).toHaveLength(0);
  });
});

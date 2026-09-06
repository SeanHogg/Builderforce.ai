import { describe, expect, it, vi } from 'vitest';
import {
  executeAsAddressedAgent,
  pickAgentRun,
  pickTaskToStart,
  type AddressedAgentRunDeps,
  type AgentRunCandidate,
} from './addressedAgentRun';

const BOB = 'd02ff7ee-bob';
const ADA = 'ada-1';

const run = (p: Partial<AgentRunCandidate> & { id: number }): AgentRunCandidate => ({
  taskId: 2394,
  status: 'completed',
  cloudAgentRef: null,
  payload: null,
  createdAt: new Date(2026, 8, 6, 12, 0, 0),
  ...p,
});

describe('pickAgentRun — which of MY runs takes the directive', () => {
  it('never picks another agent\'s run, whichever way the agent is recorded', () => {
    const runs = [run({ id: 1, cloudAgentRef: ADA }), run({ id: 2, payload: JSON.stringify({ cloudAgentRef: ADA }) })];
    expect(pickAgentRun(runs, BOB)).toBeNull();
    expect(pickAgentRun(runs, ADA)?.id).toBe(1);
  });

  it('prefers a live run (steer) over a paused one (resume) over the newest terminal one (follow-up)', () => {
    const runs = [
      run({ id: 10, cloudAgentRef: BOB, status: 'completed', createdAt: new Date(2026, 8, 6, 15) }),
      run({ id: 11, cloudAgentRef: BOB, status: 'paused', createdAt: new Date(2026, 8, 6, 13) }),
      run({ id: 12, cloudAgentRef: BOB, status: 'running', createdAt: new Date(2026, 8, 6, 11) }),
    ];
    expect(pickAgentRun(runs, BOB)?.id).toBe(12);
    expect(pickAgentRun(runs.filter((r) => r.id !== 12), BOB)?.id).toBe(11);
    expect(pickAgentRun(runs.filter((r) => r.id === 10), BOB)?.id).toBe(10);
  });

  it('among terminal runs takes the NEWEST — the branch the latest work is on', () => {
    const runs = [
      run({ id: 20, payload: JSON.stringify({ cloudAgentRef: BOB }), createdAt: new Date(2026, 8, 5) }),
      run({ id: 21, payload: JSON.stringify({ cloudAgentRef: BOB }), createdAt: new Date(2026, 8, 6) }),
    ];
    expect(pickAgentRun(runs, BOB)?.id).toBe(21);
  });
});

describe('pickTaskToStart — where a first run goes', () => {
  it('takes the named ticket, else the one assigned to me, else the only linked one', () => {
    expect(pickTaskToStart([{ id: 1, assignedAgentRef: ADA }], BOB, 7)).toEqual({ taskId: 7 });
    expect(pickTaskToStart([{ id: 1, assignedAgentRef: ADA }, { id: 2, assignedAgentRef: BOB }], BOB)).toEqual({ taskId: 2 });
    expect(pickTaskToStart([{ id: 3, assignedAgentRef: null }], BOB)).toEqual({ taskId: 3 });
  });

  it('reports ambiguity and emptiness instead of guessing', () => {
    expect(pickTaskToStart([{ id: 1, assignedAgentRef: null }, { id: 2, assignedAgentRef: null }], BOB)).toMatchObject({ error: expect.stringContaining('pass the taskId') });
    expect(pickTaskToStart([], BOB)).toMatchObject({ error: expect.stringContaining('no runnable ticket') });
  });
});

describe('executeAsAddressedAgent', () => {
  function deps(over: Partial<AddressedAgentRunDeps> & { replayImpl?: (m: string, p: string, b: Record<string, unknown>) => unknown } = {}) {
    const replay = vi.fn(async (m: 'POST' | 'PATCH', p: string, b: Record<string, unknown>) => over.replayImpl?.(m, p, b) ?? { ok: true });
    const d: AddressedAgentRunDeps = {
      linkedRunnableTasks: over.linkedRunnableTasks ?? (async () => [{ id: 2394, assignedAgentRef: BOB }]),
      runsForTasks: over.runsForTasks ?? (async () => []),
      isLifecycleManaged: over.isLifecycleManaged ?? (async () => false),
      replay,
    };
    return { d, replay };
  }
  const ctx = (agentRef: string | null) => ({ agentRef, tenantId: 1, db: {} } as never);

  it('refuses a caller that is not an agent', async () => {
    const { d } = deps();
    await expect(executeAsAddressedAgent(ctx(null), { chatId: 99, directive: 'push' }, d)).rejects.toThrow(/addressed agent/);
  });

  it('hands the directive to MY latest run through the one directive route (follow-up on a terminal run)', async () => {
    const { d, replay } = deps({
      runsForTasks: async () => [run({ id: 501, cloudAgentRef: BOB, status: 'completed' })],
      replayImpl: () => ({ ok: true, rerun: { executionId: 777 } }),
    });
    const r = await executeAsAddressedAgent(ctx(BOB), { chatId: 99, directive: 'merge your changes and push to main' }, d);
    expect(replay).toHaveBeenCalledWith('POST', '/api/runtime/executions/501/messages', { text: 'merge your changes and push to main' });
    expect(r).toMatchObject({ mode: 'rerun', executionId: 777, taskId: 2394 });
  });

  it('steers a live run and reports it as steered', async () => {
    const { d } = deps({
      runsForTasks: async () => [run({ id: 502, cloudAgentRef: BOB, status: 'running' })],
      replayImpl: () => ({ ok: true, steered: true }),
    });
    expect(await executeAsAddressedAgent(ctx(BOB), { chatId: 99, directive: 'also run the tests' }, d)).toMatchObject({ mode: 'steered', executionId: 502 });
  });

  it('surfaces an approval gate instead of pretending the run started', async () => {
    const { d } = deps({
      runsForTasks: async () => [run({ id: 503, cloudAgentRef: BOB })],
      replayImpl: () => ({ status: 'awaiting_approval', approvalId: 'ap_1' }),
    });
    expect(await executeAsAddressedAgent(ctx(BOB), { chatId: 99, directive: 'push' }, d)).toMatchObject({ mode: 'awaiting_approval', approvalId: 'ap_1' });
  });

  it('with no prior run: assigns me, starts the ticket, and queues the directive as its first steer', async () => {
    const { d, replay } = deps({
      replayImpl: (_m, p) => (p.endsWith('/run-now') ? { ok: true, executionId: 900 } : { ok: true }),
    });
    const r = await executeAsAddressedAgent(ctx(BOB), { chatId: 99, directive: 'fix the failing build' }, d);
    expect(replay.mock.calls.map(([m, p]) => `${m} ${p}`)).toEqual([
      'PATCH /api/tasks/2394',
      'POST /api/tasks/2394/run-now',
      'POST /api/runtime/executions/900/messages',
    ]);
    expect(r).toMatchObject({ mode: 'started', executionId: 900, taskId: 2394 });
  });

  it('on a lifecycle-managed board it dispatches without reassigning', async () => {
    const { d, replay } = deps({
      isLifecycleManaged: async () => true,
      replayImpl: (_m, p) => (p.endsWith('/run-now') ? { ok: true, executionId: 901 } : { ok: true }),
    });
    await executeAsAddressedAgent(ctx(BOB), { chatId: 99, directive: 'ship it' }, d);
    expect(replay.mock.calls.some(([m]) => m === 'PATCH')).toBe(false);
  });

  it('never steers ANOTHER agent\'s run on the same ticket — it starts its own instead', async () => {
    const { d, replay } = deps({
      runsForTasks: async () => [run({ id: 600, cloudAgentRef: ADA, status: 'running' })],
      replayImpl: (_m, p) => (p.endsWith('/run-now') ? { ok: true, executionId: 902 } : { ok: true }),
    });
    await executeAsAddressedAgent(ctx(BOB), { chatId: 99, directive: 'push' }, d);
    expect(replay.mock.calls.some(([, p]) => p.includes('/executions/600/'))).toBe(false);
    expect(replay.mock.calls.some(([, p]) => p.endsWith('/run-now'))).toBe(true);
  });
});

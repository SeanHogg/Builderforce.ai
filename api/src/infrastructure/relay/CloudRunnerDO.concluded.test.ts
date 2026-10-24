import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CloudRunnerDO — the concluded check is cached so a ticking run does not read the
 * `executions` row on every alarm and every 2s cancel poll:
 *   • a "not concluded" answer is trusted for a short window;
 *   • `/concluded` (sent by RuntimeService.cancel) makes the next tick stop with no read;
 *   • the terminal transition still reads the row fresh, so it never clobbers a cancel.
 */

const h = vi.hoisted(() => ({
  selects: 0,
  status: 'running',
  /** Statuses served before falling back to `status`, one per read. */
  statusQueue: [] as string[],
  runs: 0,
  updates: [] as Array<Record<string, unknown>>,
  loopResult: null as Record<string, unknown> | null,
}));

vi.mock('../database/connection', () => ({
  buildDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => { h.selects += 1; return [{ status: h.statusQueue.shift() ?? h.status }]; } }) }) }),
    update: () => ({ set: () => ({ where: () => Object.assign(Promise.resolve([]), { returning: async () => [] }) }) }),
  }),
}));
vi.mock('../../buildRuntimeService', () => ({
  buildRuntimeService: () => ({
    update: vi.fn(async (_id: number, dto: Record<string, unknown>) => { h.updates.push(dto); return {}; }),
    postLifecycleMilestoneById: vi.fn(async () => {}),
  }),
}));
vi.mock('../../application/runtime/cloudAgentEngine', () => ({
  prepareCloudRun: vi.fn(),
  resolveAgentEngine: vi.fn(() => ({ id: 'builderforce-v3', run: vi.fn(async () => { h.runs += 1; return h.loopResult; }) })),
  markCloudExecutionRunning: vi.fn(async () => {}),
  initialCloudLimbicState: vi.fn(() => ({})),
  evolveCloudLimbicState: vi.fn((s: unknown) => s),
  recordLimbicState: vi.fn(async () => {}),
}));
vi.mock('../../application/runtime/cloudChildRuns', () => ({
  parseCloudChild: () => null,
  childBrief: () => ({}),
  settleCloudChildLineage: vi.fn(async () => {}),
}));
vi.mock('../../application/artifact/capabilityContext', () => ({ loadPersonaSetpoints: vi.fn(async () => ({})) }));
vi.mock('../../application/runtime/scoreRunOutcome', () => ({ scoreRunOutcome: vi.fn(async () => {}) }));
vi.mock('../../application/runtime/lateSteerFollowUp', () => ({ settleLateSteersSafely: vi.fn(async () => ({ kind: 'none' })) }));
vi.mock('../../application/runtime/cloudDispatch', () => ({
  parseModel: () => undefined,
  parseRoutingBias: () => null,
  parseArcStage: () => null,
  parsePolicyGates: () => null,
  parseReviewRole: () => null,
  parseLaneKey: () => null,
  parseOriginatingChatId: () => null,
  parseExecutor: () => undefined,
}));
// The run's sandbox: none here (no container binding), so ticks run shell-less.
vi.mock('../../application/runtime/sandbox/runSandboxHost', () => ({
  ACTIONS_RUNNER_WAIT_MS: 20 * 60_000,
  RunSandboxHost: class {
    async prepare() { return undefined; }
    forTick() { return undefined; }
    async awaitingRunner() { return false; }
    async handleRunnerPoll() { return { idle: true }; }
    handleRunnerResult() { return false; }
    async park() {}
    reopen() {}
    async close() {}
  },
}));
vi.mock('../../application/runtime/githubActionsDispatch', () => ({ dispatchGithubActionsRun: vi.fn(async () => ({ ok: true })) }));
vi.mock('@seanhogg/builderforce-memory-engine/limbic', () => ({ buildLimbicBlock: () => '' }));

import { CloudRunnerDO } from './CloudRunnerDO';

const EXEC_ID = 91;

function makeDo() {
  const storage = new Map<string, unknown>();
  const state = {
    storage: {
      get: async (k: string) => storage.get(k),
      put: async (k: string, v: unknown) => { storage.set(k, v); },
      delete: async (k: string) => storage.delete(k),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
  };
  return { runner: new CloudRunnerDO(state as never, {} as never), storage };
}

const loopCursor = () => ({
  stage: 'loop', executionId: EXEC_ID, tenantId: 1, projectId: 2, taskId: 7,
  taskTitle: 'ticket', taskDescription: null, agentLabel: 'Dev Agent', limbic: false,
});

const concluded = (runner: CloudRunnerDO) =>
  runner.fetch(new Request('https://cloud-runner/concluded', { method: 'POST' }));

beforeEach(() => {
  h.selects = 0;
  h.status = 'running';
  h.statusQueue.length = 0;
  h.runs = 0;
  h.updates.length = 0;
  h.loopResult = { ok: true, output: '', cancelled: false, finished: false, state: { step: 1 } };
});

describe('CloudRunnerDO concluded cache', () => {
  it('reads the row once across back-to-back ticks', async () => {
    const { runner, storage } = makeDo();
    storage.set('cursor', loopCursor());
    await runner.alarm();
    await runner.alarm();
    await runner.alarm();
    expect(h.runs).toBe(3);
    expect(h.selects).toBe(1);
  });

  it('/concluded stops the next tick without a read or another step', async () => {
    const { runner, storage } = makeDo();
    storage.set('cursor', loopCursor());
    const res = await concluded(runner);
    expect(res.status).toBe(204);
    await runner.alarm();
    expect(h.selects).toBe(0);
    expect(h.runs).toBe(0);
    // Cleaned up: the cursor and the flag are gone, so a requeue starts clean.
    expect(storage.has('cursor')).toBe(false);
    expect(storage.has('concluded')).toBe(false);
  });

  it('/concluded records nothing when this DO holds no run', async () => {
    const { runner, storage } = makeDo();
    expect((await concluded(runner)).status).toBe(204);
    expect(storage.has('concluded')).toBe(false);
  });

  it('the terminal transition reads the row fresh and never clobbers a cancel', async () => {
    const { runner, storage } = makeDo();
    storage.set('cursor', loopCursor());
    h.loopResult = { ok: true, output: 'done', cancelled: false, finished: true };
    // Tick start says running; the row is cancelled before the step ends.
    h.statusQueue.push('running', 'cancelled');
    await runner.alarm();
    expect(h.selects).toBe(2); // tick start + fresh terminal guard
    expect(h.updates).toEqual([]);
  });

  it('completes normally when the fresh read still says running', async () => {
    const { runner, storage } = makeDo();
    storage.set('cursor', loopCursor());
    h.loopResult = { ok: true, output: 'done', cancelled: false, finished: true };
    await runner.alarm();
    expect(h.selects).toBe(2);
    expect(h.updates).toEqual([{ status: 'completed', result: 'done' }]);
  });
});

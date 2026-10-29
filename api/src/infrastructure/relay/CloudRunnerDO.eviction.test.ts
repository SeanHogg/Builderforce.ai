import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CloudRunnerDO — a platform EVICTION during a tick is not a run failure (PRD 35 WS3). The cloud adapter re-throws
 * any exception that is not a model-transport failure; this proves the Durable Object then re-arms the run from its
 * cursor and never marks the execution FAILED.
 */

const h = vi.hoisted(() => ({
  selects: 0,
  status: 'running',
  /** Statuses served before falling back to `status`, one per read. */
  statusQueue: [] as string[],
  runs: 0,
  updates: [] as Array<Record<string, unknown>>,
  loopResult: null as Record<string, unknown> | null,
  thrown: 'Durable Object reset because its code was updated.',
  alarms: [] as number[],
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
  resolveAgentEngine: vi.fn(() => ({ id: 'builderforce-v3', run: vi.fn(async () => { h.runs += 1; throw new Error(h.thrown); }) })),
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

function makeDo() {
  const storage = new Map<string, unknown>();
  const state = {
    storage: {
      get: async (k: string) => storage.get(k),
      put: async (k: string, v: unknown) => { storage.set(k, v); },
      delete: async (k: string) => storage.delete(k),
      setAlarm: async (at: number) => { h.alarms.push(at); },
      deleteAlarm: async () => {},
    },
  };
  return { runner: new CloudRunnerDO(state as never, {} as never), storage };
}

const loopCursor = () => ({
  stage: 'loop', executionId: 91, tenantId: 1, projectId: 2, taskId: 7,
  taskTitle: 'ticket', taskDescription: null, agentLabel: 'Dev Agent', limbic: false,
});

beforeEach(() => {
  h.selects = 0; h.status = 'running'; h.statusQueue.length = 0; h.runs = 0; h.updates.length = 0; h.alarms.length = 0;
});

describe('CloudRunnerDO eviction', () => {
  it('re-arms an eviction-shaped throw from the engine and leaves the execution non-FAILED, cursor intact', async () => {
    h.thrown = 'Durable Object reset because its code was updated.';
    const { runner, storage } = makeDo();
    storage.set('cursor', loopCursor());
    await runner.alarm();
    expect(h.runs).toBe(1);
    expect(h.updates.some((dto) => dto.status === 'failed')).toBe(false);
    expect(storage.has('cursor')).toBe(true);
    expect(h.alarms.length).toBeGreaterThan(0);
  });

  it('still fails the run on an ordinary exception', async () => {
    h.thrown = 'the gateway exploded';
    const { runner, storage } = makeDo();
    storage.set('cursor', loopCursor());
    await runner.alarm();
    expect(h.updates.some((dto) => dto.status === 'failed')).toBe(true);
  });
});

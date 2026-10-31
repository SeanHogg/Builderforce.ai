import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CloudRunnerDO — how the Actions runner's `/sandbox/next` poll and `/concluded` reach the run's sandbox
 * host. The host is REAL here (its own rules are in sandboxMailboxLifecycle.test.ts); this proves the DO
 * hands it the right fact: whether the run still has its persisted cursor.
 *   • no cursor (the run ended, then the DO was evicted) ⇒ a stale runner is told to stop;
 *   • a cursor, including one parked on a question ⇒ the runner stays served;
 *   • `/concluded` on a parked run arms the alarm that cleans it up.
 */

const h = vi.hoisted(() => ({
  selects: 0,
  status: 'running',
  statusQueue: [] as string[],
  runs: 0,
  updates: [] as Array<Record<string, unknown>>,
  loopResult: null as Record<string, unknown> | null,
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
vi.mock('../../application/runtime/githubActionsDispatch', () => ({ dispatchGithubActionsRun: vi.fn(async () => ({ ok: true })) }));
vi.mock('@seanhogg/builderforce-memory-engine/limbic', () => ({ buildLimbicBlock: () => '' }));

vi.mock('../../application/runtime/cloudToolEvents', () => ({ recordCloudToolEvent: vi.fn(async () => {}) }));
vi.mock('../../application/runtime/sandbox/sandboxOpenSpec', () => ({ buildSandboxOpenSpec: vi.fn() }));

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

/** A run parked on an ask_human question: its cursor is kept, its runner was released. */
const parkedCursor = () => ({
  stage: 'loop', executionId: 91, tenantId: 1, projectId: 2, taskId: 7,
  taskTitle: 'ticket', taskDescription: null, agentLabel: 'Dev Agent', limbic: false, sandbox: 'actions',
});

const next = async (runner: CloudRunnerDO) => (await runner.fetch(new Request('https://cloud-runner/sandbox/next', { method: 'POST', body: '{}' }))).json();

beforeEach(() => {
  h.selects = 0; h.status = 'running'; h.statusQueue.length = 0; h.runs = 0; h.updates.length = 0; h.alarms.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe('CloudRunnerDO /sandbox/next', () => {
  it('tells a stale runner to stop when the DO holds no run, and does not mark the runner seen', async () => {
    const { runner, storage } = makeDo();
    await expect(next(runner)).resolves.toEqual({ close: true });
    expect(storage.has('sandboxRunnerSeen')).toBe(false);
  });

  it('keeps serving the runner of a live run, including one parked on a question', async () => {
    vi.useFakeTimers();
    const { runner, storage } = makeDo();
    storage.set('cursor', parkedCursor());
    storage.set('sandboxRunnerSeen', false);
    const polled = next(runner);
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(polled).resolves.toEqual({ idle: true });
  });
});

describe('CloudRunnerDO /concluded on a parked run', () => {
  const concluded = (runner: CloudRunnerDO) => runner.fetch(new Request('https://cloud-runner/concluded', { method: 'POST' }));

  it('arms the alarm, so the parked run is cleaned up and its cursor stops reading as live', async () => {
    const { runner, storage } = makeDo();
    storage.set('cursor', parkedCursor());
    expect((await concluded(runner)).status).toBe(204);
    expect(h.alarms).toHaveLength(1);
    await runner.alarm();
    expect(storage.has('cursor')).toBe(false);
    await expect(next(runner)).resolves.toEqual({ close: true });
  });

  it('arms nothing when the DO holds no run', async () => {
    const { runner } = makeDo();
    await concluded(runner);
    expect(h.alarms).toHaveLength(0);
  });
});

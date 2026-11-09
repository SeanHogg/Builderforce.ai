/**
 * Governance gates reach the dispatched run.
 *
 * `RuntimeService.submit` resolves the tenant's gates and stamps them onto the stored payload; `startDispatchedExecution` is the
 * one choke point every dispatch funnels through (board dispatch, `/runtime/tasks` start and retry, the follow-up run), and it
 * used to build the host frame and the cloud run from the CALLER's original payload, which has no gates. It now starts from the
 * stored payload. These pin that, on the frame sent to the host.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

const ensureTaskPrd = vi.fn(async (..._a: unknown[]) => '# Drafted PRD');
const resolveCloudAgent = vi.fn();
const markCloudExecutionRunning = vi.fn(async (..._a: unknown[]) => undefined);
const recordCloudToolEvent = vi.fn(async (..._a: unknown[]) => undefined);
const reportCaughtError = vi.fn();

vi.mock('./cloudAgent/prd', () => ({
  ensureTaskPrd: (...a: unknown[]) => ensureTaskPrd(...a),
}));
vi.mock('./cloudAgentEngine', () => ({
  markCloudExecutionRunning: (...a: unknown[]) => markCloudExecutionRunning(...a),
  recordCloudToolEvent: (...a: unknown[]) => recordCloudToolEvent(...a),
  resolveCloudAgent: (...a: unknown[]) => resolveCloudAgent(...a),
  agentAllowsHostExecution: (s: string | undefined) => s !== 'cloud',
}));
vi.mock('../observability/caughtErrorReporter', () => ({
  reportCaughtError: (...a: unknown[]) => reportCaughtError(...a),
  reportedFallback: (fallback: unknown) => () => fallback,
}));
vi.mock('../tenant/featureEntitlements', () => ({
  tenantHasFeature: async () => false,
}));
vi.mock('../repos/resolveDefaultRepo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repos/resolveDefaultRepo')>();
  return {
    ...actual,
    resolveDefaultRepoForTask: async () => null,
  };
});
vi.mock('../artifact/resolveArtifacts', () => ({
  resolveArtifacts: async () => undefined,
}));
vi.mock('./executionEvents', () => ({
  notifyExecutionSubscribers: () => undefined,
}));
vi.mock('./defaultCloudAgent', () => ({
  resolveDefaultCloudAgentRef: async () => ({ ref: null, reason: 'none' }),
  UNATTRIBUTED_RUN_MESSAGE: { none: 'unattributed' },
}));
vi.mock('./cloudRunLedger', () => ({
  enforceCloudRunCap: async () => ({ allowed: true }),
}));
vi.mock('./githubActionsDispatch', () => ({
  dispatchGithubActionsRun: vi.fn(),
}));
vi.mock('../llm/projectEvermind', () => ({
  resolveProjectInferenceModel: async () => undefined,
}));

const { startDispatchedExecution } = await import('./dispatchCloudRun');

const tenantId = 1;
const taskRow = {
  id: 42,
  title: 'Add auth',
  description: 'Wire login',
  assignedAgentHostId: 7,
  assignedAgentRef: 'agent-1',
  assignedUserId: null,
  priority: 'medium' as const,
  projectId: 2,
};
const GATES = [{ id: '1:no-shell', tool: 'run_command', effect: 'block', reason: 'prod safety' }, { id: '1:ro', sideEffect: 'mutate', effect: 'require-approval' }];
const gatedPayload = JSON.stringify({ cloudAgentRef: 'agent-1', policyGates: GATES });
const submitted = (payload: string | null) => ({ id: 99, status: 'queued', toPlain: () => ({ id: 99, status: 'queued', payload }) });

function hostEnv() {
  const hostFetches: string[] = [];
  const frames: Array<{ payload?: string }> = [];
  const env = {
    AGENT_HOST_RELAY: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (url: string, init?: { body?: string }) => {
          hostFetches.push(url);
          if (init?.body) frames.push(JSON.parse(init.body) as { payload?: string });
          return new Response('ok', { status: 200 });
        },
      }),
    },
  } as never;
  return { env, hostFetches, frames };
}

const db = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([{ id: 7 }]),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => Promise.resolve([]),
    }),
  }),
} as unknown as Db;

const gatesOf = (frame: { payload?: string } | undefined) =>
  (JSON.parse(frame?.payload ?? '{}') as { policyGates?: unknown[] }).policyGates;

describe('startDispatchedExecution - gates reach the dispatched run', () => {
  beforeEach(() => {
    ensureTaskPrd.mockReset().mockResolvedValue('# Drafted PRD');
    resolveCloudAgent.mockReset().mockResolvedValue({
      ref: 'agent-1', label: 'Ada', engine: 'v2', active: true, runtimeSupport: 'both', runtimeSurface: 'durable', baseModel: 'gpt-4o',
    });
    reportCaughtError.mockClear();
  });

  it('sends the host the stored (gated) payload even though the caller passes its original, gate-less one', async () => {
    const { env, frames } = hostEnv();

    await startDispatchedExecution(
      env, db, {} as never, vi.fn(), tenantId, submitted(gatedPayload), taskRow,
      JSON.stringify({ cloudAgentRef: 'agent-1' }), // what a board dispatch, a route start/retry and a follow-up run hold
    );

    expect(frames).toHaveLength(1);
    expect(gatesOf(frames[0])).toEqual(GATES);
  });

  it('keeps every other field of the stored payload', async () => {
    const { env, frames } = hostEnv();

    await startDispatchedExecution(
      env, db, {} as never, vi.fn(), tenantId,
      submitted(JSON.stringify({ cloudAgentRef: 'agent-1', laneKey: 'in_progress', policyGates: GATES })), taskRow, undefined,
    );

    expect(JSON.parse(frames[0]!.payload!)).toMatchObject({ cloudAgentRef: 'agent-1', laneKey: 'in_progress' });
  });

  it('falls back to the caller payload when the run has none stored', async () => {
    const { env, frames } = hostEnv();

    await startDispatchedExecution(
      env, db, {} as never, vi.fn(), tenantId, submitted(null), taskRow, JSON.stringify({ cloudAgentRef: 'agent-1' }),
    );

    expect(gatesOf(frames[0])).toBeUndefined();
  });
});

describe('storedPayloadOf', () => {
  it('prefers the stored payload and falls back otherwise', async () => {
    const { storedPayloadOf } = await import('./dispatchCloudRun');
    expect(storedPayloadOf(submitted('{"a":1}'), '{"b":2}')).toBe('{"a":1}');
    expect(storedPayloadOf(submitted(null), '{"b":2}')).toBe('{"b":2}');
    expect(storedPayloadOf(submitted(''), undefined)).toBeUndefined();
  });
});

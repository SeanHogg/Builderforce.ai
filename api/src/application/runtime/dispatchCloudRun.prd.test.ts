/**
 * PRD-first at the dispatch choke point.
 *
 * Host-delivered runs (On-Prem / pinned agent host) never enter prepareCloudRun,
 * which used to be the only caller of ensureTaskPrd. startDispatchedExecution is
 * the one path every surface funnels through, so the draft has to happen here —
 * before dispatchToAgentHost — or a host run starts against a ticket with no PRD.
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
vi.mock('./containerRunLauncher', () => ({
  launchContainerRun: vi.fn(),
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
const execution = {
  id: 99,
  status: 'queued',
  toPlain: () => ({ id: 99, status: 'queued' }),
};

function hostEnv() {
  const hostFetches: string[] = [];
  const env = {
    AGENT_HOST_RELAY: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (url: string) => {
          hostFetches.push(url);
          return new Response('ok', { status: 200 });
        },
      }),
    },
  } as never;
  return { env, hostFetches };
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

describe('startDispatchedExecution — PRD-first (host-delivered)', () => {
  beforeEach(() => {
    ensureTaskPrd.mockReset().mockResolvedValue('# Drafted PRD');
    resolveCloudAgent.mockReset().mockResolvedValue({
      ref: 'agent-1',
      label: 'Ada',
      engine: 'v2',
      active: true,
      runtimeSupport: 'both',
      runtimeSurface: 'durable',
      baseModel: 'gpt-4o',
    });
    markCloudExecutionRunning.mockClear();
    recordCloudToolEvent.mockClear();
    reportCaughtError.mockClear();
  });

  it('calls ensureTaskPrd BEFORE dispatching to the pinned host', async () => {
    const { env, hostFetches } = hostEnv();
    const order: string[] = [];
    ensureTaskPrd.mockImplementation(async () => {
      order.push('prd');
      return '# Drafted PRD';
    });
    const relay = env as {
      AGENT_HOST_RELAY: { get: () => { fetch: (url: string) => Promise<Response> } };
    };
    relay.AGENT_HOST_RELAY.get = () => ({
      fetch: async (url: string) => {
        order.push('host');
        hostFetches.push(url);
        return new Response('ok', { status: 200 });
      },
    });

    await startDispatchedExecution(
      env,
      db,
      {} as never,
      vi.fn(),
      tenantId,
      execution,
      taskRow,
      JSON.stringify({ cloudAgentRef: 'agent-1' }),
    );

    expect(ensureTaskPrd).toHaveBeenCalledOnce();
    const args = ensureTaskPrd.mock.calls[0]!;
    expect(args[2]).toBe(99); // executionId
    expect(args[3]).toEqual({ title: 'Add auth', description: 'Wire login' });
    expect(args[6]).toBe(42); // taskId
    expect(args[7]).toBe('Ada');
    // Rehearsal never enters this function — readOnly must stay off.
    expect(args[9]).toBeUndefined();
    expect(hostFetches.length).toBe(1);
    expect(order).toEqual(['prd', 'host']);
  });

  it('still delivers to the host when the PRD draft misses', async () => {
    const { env, hostFetches } = hostEnv();
    ensureTaskPrd.mockRejectedValue(new Error('llm down'));

    await startDispatchedExecution(
      env,
      db,
      {} as never,
      vi.fn(),
      tenantId,
      execution,
      taskRow,
      JSON.stringify({ cloudAgentRef: 'agent-1' }),
    );

    expect(hostFetches.length).toBe(1);
    expect(reportCaughtError).toHaveBeenCalled();
  });
});

/**
 * The whole vocabulary a run sandbox may speak back: its timeline events, and — for the
 * pull-driven Actions runner — its spec, the engine's next request, the result, and a
 * cancel poll. No model turn, commit or finalize exists here to ask for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  record: vi.fn(async () => undefined),
  repo: vi.fn(async () => ({ ok: true, ctx: { base: 'main', branch: 'bf/5' } })),
  cancelled: vi.fn(async () => false),
}));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));
vi.mock('../../repos/commitFileAsPendingChange', () => ({ resolveTicketRepoContext: h.repo }));
vi.mock('../../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../cloudAgent/runContext', () => ({ isExecutionCancelled: h.cancelled }));

import { handleSandboxCallback } from './sandboxCallbacks';

const ctx = { tenantId: 1, taskId: 5, projectId: 2, cloudAgentRef: 'a1' };

/** A db whose `select().from().where().limit()` answers with one execution status. */
function dbWithStatus(status: string | null) {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (status ? [{ status }] : []) }) }) }),
  } as never;
}

/** A CLOUD_RUNNER binding recording what the callbacks relay to the run's DO. */
function runnerEnv(reply: unknown = { request: { id: 'r1', path: '/sandbox/fs', body: { op: 'list' } } }) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const env = {
    COST_LEVERS_ALL: 'off',
    CLOUD_RUNNER: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (url: string, init?: RequestInit) => {
          calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
          return Response.json(reply);
        },
      }),
    },
  } as never;
  return { env, calls };
}

beforeEach(() => {
  for (const f of [h.record, h.repo, h.cancelled]) f.mockClear();
});

describe('handleSandboxCallback', () => {
  it('records a sandbox event on the run timeline', async () => {
    const { env } = runnerEnv();
    const r = await handleSandboxCallback(env, dbWithStatus('running'), ctx, 77, 'event', {
      toolName: 'runtime.clone', category: 'planning', detail: { branch: 'bf/5' }, result: 'cloned',
    });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(h.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 1, cloudAgentRef: 'a1', executionId: 77, toolName: 'runtime.clone', category: 'planning', result: 'cloned',
    }));
  });

  it('serves the runner its spec: the levers it obeys and the branch it serves', async () => {
    const { env } = runnerEnv();
    const r = await handleSandboxCallback(env, dbWithStatus('running'), ctx, 77, 'spec', {});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ executionId: 77, toolOutputPolicy: false, postEditChecks: false, repo: { baseBranch: 'main', headBranch: 'bf/5' } });
  });

  it('refuses a spec to a runner that started after its run was cancelled', async () => {
    const { env } = runnerEnv();
    expect((await handleSandboxCallback(env, dbWithStatus('cancelled'), ctx, 77, 'spec', {})).status).toBe(409);
    expect((await handleSandboxCallback(env, dbWithStatus(null), ctx, 77, 'spec', {})).status).toBe(409);
  });

  it('relays the runner poll and its results to the run\'s durable runner', async () => {
    const { env, calls } = runnerEnv();
    const next = await handleSandboxCallback(env, dbWithStatus('running'), ctx, 77, 'sandbox_next', {});
    expect(next.body).toEqual({ request: { id: 'r1', path: '/sandbox/fs', body: { op: 'list' } } });
    await handleSandboxCallback(env, dbWithStatus('running'), ctx, 77, 'sandbox_result', { id: 'r1', result: { ok: true, paths: [] }, extra: 'dropped' });
    expect(calls).toEqual([
      { url: 'https://cloud-runner/sandbox/next', body: {} },
      { url: 'https://cloud-runner/sandbox/result', body: { id: 'r1', result: { ok: true, paths: [] } } },
    ]);
  });

  it('answers 503 when no durable runner is bound', async () => {
    const r = await handleSandboxCallback({} as never, dbWithStatus('running'), ctx, 77, 'sandbox_next', {});
    expect(r.status).toBe(503);
  });

  it('answers a running command\'s cancel poll', async () => {
    const { env } = runnerEnv();
    h.cancelled.mockResolvedValueOnce(true);
    expect(await handleSandboxCallback(env, dbWithStatus('running'), ctx, 77, 'sandbox_status', {})).toEqual({ status: 200, body: { cancelled: true } });
  });

  it('knows no loop op — a sandbox decides nothing', async () => {
    const { env } = runnerEnv();
    for (const op of ['llm', 'write', 'finalize', 'fail', 'ask_human', 'memory', 'nope']) {
      expect((await handleSandboxCallback(env, dbWithStatus('running'), ctx, 77, op, {})).status).toBe(400);
    }
  });
});

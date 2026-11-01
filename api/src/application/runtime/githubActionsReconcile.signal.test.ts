/**
 * reconcileGithubActionsRuns — re-signals the KV-gated cron tick while a dispatch is still inside
 * its 6-15 minute window, and goes quiet when none is. The window is bounded by the reaper
 * deadline, so nothing here can signal indefinitely.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCronKv } from './__fixtures__/fakeCronKv';

const resolveRepo = vi.fn(async () => ({ provider: 'github', repoId: 'r1' }));
const githubRequest = vi.fn();
vi.mock('../repos/resolveDefaultRepo', () => ({ resolveDefaultRepoForTask: (...a: unknown[]) => resolveRepo(...(a as [])) }));
vi.mock('../repos/githubClient', () => ({
  githubRequest: (...a: unknown[]) => githubRequest(...a),
  repoPath: (_coords: unknown, path: string) => path,
  resolveRepoAuth: async () => ({ ok: true, auth: { coords: {} } }),
}));
vi.mock('./failStrandedDispatch', () => ({ failStrandedDispatch: vi.fn(async () => true) }));

import { reconcileGithubActionsRuns } from './githubActionsReconcile';
import { agentRunName } from './githubActionsWorkflow';

const GH_PAYLOAD = '{"executor":"github_actions"}';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/**
 * candidates = the stranded-dispatch read (selects `taskId`); the grace-window probe selects only
 * `payload`. Both are `where().…limit()`; the candidates read also has `orderBy()` and `.catch()`.
 */
function dbWith(candidates: Array<Record<string, unknown>>, young: Array<Record<string, unknown>>) {
  return {
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          if ('taskId' in fields) {
            return { orderBy: () => ({ limit: () => Object.assign(Promise.resolve(candidates), { catch: () => Promise.resolve(candidates) }) }) };
          }
          return { limit: async () => young };
        },
      }),
    }),
  } as never;
}

const candidate = (id: number) => ({ id, tenantId: 1, taskId: 5, payload: GH_PAYLOAD, cloudAgentRef: null, createdAt: minutesAgo(8) });
const run = (id: number, status: string) => ({ ok: true, data: { workflow_runs: [{ status, conclusion: null, display_title: agentRunName(id), html_url: 'u', created_at: new Date().toISOString() }] } });

beforeEach(() => { githubRequest.mockReset(); });

describe('reconcileGithubActionsRuns — cron gate', () => {
  it('signals while a dispatch is confirmed alive on GitHub (inside the window, left alone)', async () => {
    const { env, signalled } = fakeCronKv();
    githubRequest.mockResolvedValue(run(11, 'queued'));
    const r = await reconcileGithubActionsRuns(env, Date.now(), dbWith([candidate(11)], []), {} as never);
    expect(r.stillQueued).toBe(1);
    expect(signalled()).toBe(true);
  });

  it('signals while a dispatch is still waiting out the 6-minute grace period', async () => {
    const { env, signalled } = fakeCronKv();
    await reconcileGithubActionsRuns(env, Date.now(), dbWith([], [{ payload: GH_PAYLOAD }]), {} as never);
    expect(signalled()).toBe(true);
  });

  it('does NOT signal when no GitHub Actions dispatch is in flight', async () => {
    const { env, signalled } = fakeCronKv();
    await reconcileGithubActionsRuns(env, Date.now(), dbWith([], []), {} as never);
    expect(signalled()).toBe(false);
  });

  it('does NOT signal for a young execution that is not a GitHub Actions dispatch', async () => {
    const { env, signalled } = fakeCronKv();
    await reconcileGithubActionsRuns(env, Date.now(), dbWith([], [{ payload: '{"executor":"durable"}' }]), {} as never);
    expect(signalled()).toBe(false);
  });

  it('does NOT signal once the stranded dispatch was failed (nothing left in the window)', async () => {
    const { env, signalled } = fakeCronKv();
    githubRequest.mockResolvedValue({ ok: true, data: { workflow_runs: [] } }); // GitHub never scheduled it
    const r = await reconcileGithubActionsRuns(env, Date.now(), dbWith([candidate(12)], []), {} as never);
    expect(r.failed).toBe(1);
    expect(signalled()).toBe(false);
  });
});

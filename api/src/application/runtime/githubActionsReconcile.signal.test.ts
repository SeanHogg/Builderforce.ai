/**
 * reconcileGithubActionsRuns — re-signals the KV-gated cron tick while a dispatch it found alive
 * on GitHub is left alone inside its 6-15 minute window, and goes quiet when none is. The window is
 * bounded by the reaper deadline, so nothing here can signal indefinitely. A dispatch still inside
 * the 6-minute grace period is NOT this sweep's to signal for: the reaper's `live_runs` probe arm
 * covers every pending / submitted execution, so the sweep issues no query of its own for it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCronKv } from './__fixtures__/fakeCronKv';

const resolveRepo = vi.fn(async () => ({ provider: 'github', repoId: 'r1' }));
const githubRequest = vi.fn();
vi.mock('../repos/resolveDefaultRepo', () => ({
  resolveDefaultRepoForTask: (...a: unknown[]) => resolveRepo(...(a as [])),
  // Imported (not called) by modules the reconcile pulls in; the mock must name every export they read.
  resolveDefaultRepoForProject: vi.fn(async () => null),
}));
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
 * candidates = the stranded-dispatch read (selects `taskId`): `where().orderBy().limit()` with a
 * `.catch()`. It is the ONLY read the sweep makes; any other select throws, which is how the tests
 * below prove there is no separate grace-window probe.
 */
function dbWith(candidates: Array<Record<string, unknown>>) {
  return {
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          if (!('taskId' in fields)) throw new Error('unexpected select: the sweep reads only the stranded-dispatch candidates');
          return { orderBy: () => ({ limit: () => Object.assign(Promise.resolve(candidates), { catch: () => Promise.resolve(candidates) }) }) };
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
    const r = await reconcileGithubActionsRuns(env, Date.now(), dbWith([candidate(11)]), {} as never);
    expect(r.stillQueued).toBe(1);
    expect(signalled()).toBe(true);
  });

  it('does NOT signal, and reads nothing extra, for a dispatch still inside the grace period (the reaper owns that)', async () => {
    const { env, signalled } = fakeCronKv();
    // No stranded candidates: a young dispatch is not one yet. The throwing select proves no probe runs.
    await reconcileGithubActionsRuns(env, Date.now(), dbWith([]), {} as never);
    expect(signalled()).toBe(false);
  });

  it('does NOT signal when no GitHub Actions dispatch is in flight', async () => {
    const { env, signalled } = fakeCronKv();
    await reconcileGithubActionsRuns(env, Date.now(), dbWith([]), {} as never);
    expect(signalled()).toBe(false);
  });

  it('does NOT signal once the stranded dispatch was failed (nothing left in the window)', async () => {
    const { env, signalled } = fakeCronKv();
    githubRequest.mockResolvedValue({ ok: true, data: { workflow_runs: [] } }); // GitHub never scheduled it
    const r = await reconcileGithubActionsRuns(env, Date.now(), dbWith([candidate(12)]), {} as never);
    expect(r.failed).toBe(1);
    expect(signalled()).toBe(false);
  });
});

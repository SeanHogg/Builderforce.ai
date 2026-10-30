import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * The ESCALATION seam, which had no direct test.
 *
 * `branchTeardownDecision` is covered (it decides `pull_request_merged`) and
 * `revertMergedPullRequest` is covered (it opens the PR, or refuses). What was
 * covered only by construction is the wiring BETWEEN them: that `revertRun`
 * turns that one refusal — and only that one — into a revert PR, and that the
 * rollback row lands on `revert_pr` rather than `reverted`.
 *
 * That distinction is the whole point of this subsystem. `reverted` claims the
 * work is undone; after a merge nothing is undone until a human merges the
 * revert PR, and a row that said otherwise would be exactly the silent dishonesty
 * the rollback design exists to avoid. A test that only asserted "it returned
 * ok" would pass on the wrong status.
 */

const repoCtx = {
  provider: 'github', host: 'github.com', owner: 'acme', repo: 'app',
  token: 'ghs_x', branch: 'bf/task-7', base: 'main',
};

vi.mock('../repos/commitFileAsPendingChange', () => ({
  resolveTicketRepoContext: vi.fn(async () => ({ ok: true, ctx: repoCtx })),
}));

// `ok` and untruncated, so the decision reaches the pull-request rules rather
// than stopping at `commits_unverifiable` two rules earlier.
vi.mock('../repos/branchLifecycle', () => ({
  listBranchCommits: vi.fn(async () => ({
    ok: true, truncated: false,
    commits: [{ sha: 'aaa1111', message: 'work [bf-task-7]', author: 'bf' }],
  })),
  closePullRequest: vi.fn(async () => ({ ok: true })),
  deleteBranch: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../repos/readRepoContents', () => ({
  listBranchDiff: vi.fn(async () => ({ ok: true, truncated: false, files: [{ path: 'src/a.ts' }] })),
}));

vi.mock('../repos/recordPullRequestRow', () => ({ markPullRequestClosedById: vi.fn(async () => undefined) }));
vi.mock('../activity/activityLog', () => ({
  recordActivity: vi.fn(async () => undefined),
  cloudAgentActor: vi.fn(() => ({ kind: 'agent', id: 'a' })),
}));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: vi.fn(async () => undefined) }));

vi.mock('../repos/revertMergedPullRequest', () => ({
  revertMergedPullRequest: vi.fn(async () => ({
    ok: true, number: 99, url: 'https://github.com/acme/app/pull/99',
    branch: 'revert/task-7-pr-42', revertedSha: 'deadbeefcafe',
  })),
  revertBranchName: (taskId: number, pr: number) => `revert/task-7-pr-${pr}`,
}));

const { revertRun } = await import('./runRollback');
const { revertMergedPullRequest } = await import('../repos/revertMergedPullRequest');
const revertMock = revertMergedPullRequest as unknown as ReturnType<typeof vi.fn>;

const env = {} as Env;
const actor = { kind: 'user' as const, id: 'u1', label: 'Ada' } as never;

/** An active snapshot with a usable undo payload — the precondition set. */
const snapshot = {
  id: 'rb-1', tenantId: 7, executionId: 42, taskId: 7, segmentId: 's1', projectId: 3,
  status: 'active', branchName: 'bf/task-7', baseBranch: 'main',
  undoPayload: { writtenPaths: ['src/a.ts'], commitShas: ['aaa1111'] },
  createdAt: new Date(),
};

const execution = [{ status: 'succeeded', cloudAgentRef: 'agent-x' }];

/** The rows `revertRun` reads, in the order it reads them. */
const rowsFor = (prStatus: string, prNumber: number | null = 42) => [
  [snapshot],
  execution,
  [{ id: 'pr-1', number: prNumber, status: prStatus }],
];

beforeEach(() => {
  revertMock.mockClear();
  revertMock.mockResolvedValue({
    ok: true, number: 99, url: 'https://github.com/acme/app/pull/99',
    branch: 'revert/task-7-pr-42', revertedSha: 'deadbeefcafe',
  });
});

describe('revertRun — escalating a merged pull request', () => {
  it('opens a revert PR instead of reporting a dead end', async () => {
    const db = fakeDb(rowsFor('merged'));
    const result = await revertRun(env, db as unknown as Db, {
      tenantId: 7, executionId: 42, actor, secret: 's',
    });

    expect(result).toMatchObject({ reverted: true, mode: 'revert_pr', revertPrNumber: 99 });
    expect(revertMock).toHaveBeenCalledTimes(1);
    // Against the SNAPSHOTTED base, not whatever the task points at now.
    expect(revertMock.mock.calls[0]![0]).toMatchObject({ number: 42, base: 'main' });
  });

  it('records `revert_pr`, NOT `reverted` — nothing is undone until a human merges it', async () => {
    const db = fakeDb(rowsFor('merged'));
    await revertRun(env, db as unknown as Db, { tenantId: 7, executionId: 42, actor, secret: 's' });

    const statusWrite = db.calls
      .filter((c) => c.kind === 'update')
      .map((c) => c.payload as Record<string, unknown>)
      .find((p) => typeof p.status === 'string');
    expect(statusWrite?.status).toBe('revert_pr');
    // …and the earlier refusal is cleared, so a row that escalated does not keep
    // reporting the refusal it escalated FROM.
    expect(statusWrite?.refusalCode).toBeNull();
  });

  it('leaves the run branch alone — its commits are on the base, so deleting it undoes nothing', async () => {
    const db = fakeDb(rowsFor('merged'));
    const result = await revertRun(env, db as unknown as Db, {
      tenantId: 7, executionId: 42, actor, secret: 's',
    });
    expect(result).toMatchObject({ branchDeleted: false, prClosed: false });
  });

  it('keeps the ORIGINAL refusal when the provider cannot revert at all', async () => {
    // Bitbucket. `unsupported` must not become `merge_revert_failed`: the accurate
    // statement is still "the pull request is merged and we cannot reverse it",
    // and rewriting it would send somebody looking for a transient fault.
    revertMock.mockResolvedValue({ ok: false, code: 'unsupported', reason: 'Bitbucket has no server-side revert' });
    const db = fakeDb(rowsFor('merged'));
    const result = await revertRun(env, db as unknown as Db, {
      tenantId: 7, executionId: 42, actor, secret: 's',
    });

    expect(result).toMatchObject({ reverted: false, refusal: 'pull_request_merged' });
    const refusalWrite = db.calls
      .filter((c) => c.kind === 'update')
      .map((c) => c.payload as Record<string, unknown>)
      .find((p) => p.refusalCode != null);
    expect(refusalWrite?.refusalCode).toBe('pull_request_merged');
  });

  it('distinguishes a provider FAILURE from an unsupported provider', async () => {
    // A 500 from GitHub is a different fact from "Bitbucket cannot do this", and
    // only one of them is worth retrying.
    revertMock.mockResolvedValue({ ok: false, code: 'provider_error', reason: 'GitHub returned 500' });
    const db = fakeDb(rowsFor('merged'));
    const result = await revertRun(env, db as unknown as Db, {
      tenantId: 7, executionId: 42, actor, secret: 's',
    });
    expect(result).toMatchObject({ reverted: false, refusal: 'merge_revert_failed' });
  });

  it('does NOT escalate when the merged PR has no number to reverse', async () => {
    // The escalation is addressed by PR number; without one there is nothing to
    // revert, so the ordinary refusal path must run instead of calling out with a
    // null.
    const db = fakeDb(rowsFor('merged', null));
    const result = await revertRun(env, db as unknown as Db, {
      tenantId: 7, executionId: 42, actor, secret: 's',
    });
    expect(result).toMatchObject({ reverted: false, refusal: 'pull_request_merged' });
    expect(revertMock).not.toHaveBeenCalled();
  });
});

describe('revertRun — the refusals that must NOT escalate', () => {
  it('refuses a run whose snapshot was already spent', async () => {
    const db = fakeDb([[{ ...snapshot, status: 'reverted' }]]);
    await expect(revertRun(env, db as unknown as Db, { tenantId: 7, executionId: 42, actor, secret: 's' }))
      .resolves.toMatchObject({ reverted: false, refusal: 'already_reverted' });
    expect(revertMock).not.toHaveBeenCalled();
  });

  it('refuses a run with no snapshot at all', async () => {
    const db = fakeDb([[]]);
    await expect(revertRun(env, db as unknown as Db, { tenantId: 7, executionId: 42, actor, secret: 's' }))
      .resolves.toMatchObject({ reverted: false, refusal: 'no_snapshot' });
  });

  it('refuses when the snapshot lost its undo payload', async () => {
    const db = fakeDb([[{ ...snapshot, undoPayload: null }], execution]);
    await expect(revertRun(env, db as unknown as Db, { tenantId: 7, executionId: 42, actor, secret: 's' }))
      .resolves.toMatchObject({ reverted: false, refusal: 'no_snapshot' });
  });

  it('refuses when the execution is gone, rather than acting on half a world', async () => {
    const db = fakeDb([[snapshot], []]);
    await expect(revertRun(env, db as unknown as Db, { tenantId: 7, executionId: 42, actor, secret: 's' }))
      .resolves.toMatchObject({ reverted: false, refusal: 'execution_gone' });
    expect(revertMock).not.toHaveBeenCalled();
  });

  it('does not escalate an OPEN pull request — that one is closed, not reversed', async () => {
    // The escalation exists for exactly one refusal. An open PR is the ordinary
    // revert path, and routing it here would open a revert PR against work that
    // never landed.
    const db = fakeDb(rowsFor('open'));
    await revertRun(env, db as unknown as Db, { tenantId: 7, executionId: 42, actor, secret: 's' });
    expect(revertMock).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

/**
 * The evidence gathering wires the legacy per-task marker into the REVERT decision only:
 * a run snapshotted before per-run subjects is revertable when the snapshot recorded its
 * shas, and the automatic teardown never accepts a legacy commit.
 */

vi.mock('../repos/branchLifecycle', () => ({
  listBranchCommits: vi.fn(async () => ({
    ok: true, truncated: false,
    commits: [{ sha: 'aaa1111', message: 'Add src/a.ts — task #12 (Coder)', authorName: 'BuilderForce' }],
  })),
  deleteBranch: vi.fn(async () => ({ ok: true, deleted: true })),
}));
vi.mock('../repos/readRepoContents', () => ({
  listBranchDiff: vi.fn(async () => ({ ok: true, truncated: false, files: [{ path: 'src/a.ts' }] })),
}));
vi.mock('./runRollback', () => ({ emitRollbackEvent: vi.fn(async () => undefined) }));

const { gatherTeardownFacts } = await import('./runBranchTeardown');

const repoCtx = {
  provider: 'github', host: 'github.com', owner: 'acme', repo: 'app',
  token: 'ghs_x', branch: 'builderforce/task-12', base: 'main',
} as never;

const gather = (mode: 'revert' | 'teardown', commitShas: string[]) =>
  gatherTeardownFacts(fakeDb([[{ id: 'pr-1', number: 7, status: 'open' }]]) as unknown as Db, {
    mode, tenantId: 1, taskId: 12, executionId: 345, repoCtx, writtenPaths: ['src/a.ts'], commitShas,
  });

describe('gatherTeardownFacts — legacy per-task commits', () => {
  it('a revert accepts the legacy commit whose sha the snapshot recorded', async () => {
    const { decision } = await gather('revert', ['aaa1111']);
    expect(decision.safe).toBe(true);
  });

  it('a revert refuses it when the snapshot did not record that sha', async () => {
    const { decision } = await gather('revert', ['bbb2222']);
    expect(decision).toMatchObject({ safe: false, refusal: 'foreign_commits' });
  });

  it('a teardown never accepts a legacy commit', async () => {
    const { decision } = await gatherTeardownFacts(fakeDb([[]]) as unknown as Db, {
      mode: 'teardown', tenantId: 1, taskId: 12, executionId: 345, repoCtx, writtenPaths: ['src/a.ts'], commitShas: ['aaa1111'],
    });
    expect(decision).toMatchObject({ safe: false, refusal: 'foreign_commits' });
  });
});

/**
 * The row and the task's PR stamp are ONE transaction: both writes go through the transaction handle, and a failure
 * in either surfaces to the caller instead of leaving half of the pair.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/database/tenantScope', () => ({ scopedToTenant: () => ({}) }));

import { recordTaskPullRequest } from './recordTaskPullRequest';

const input = {
  tenantId: 1, projectId: 2, repoId: 'repo-1', taskId: 3, provider: 'github', number: 7, url: 'https://x/pull/7',
  branchName: 'builderforce/task-3', baseBranch: 'main', status: 'draft',
};

function fakeDb(opts: { stampFails?: boolean; settled?: boolean } = {}) {
  const writes: string[] = [];
  const outside = vi.fn();
  const tx = {
    insert: () => ({ values: (v: Record<string, unknown>) => ({ onConflictDoUpdate: () => ({ returning: async () => {
      if (opts.settled) return []; // the conflict was skipped by `setWhere`: the row is merged/closed
      writes.push(`insert:${String(v.status)}:${String(v.platformDraftExecutionId)}`); return [{ id: 'row-1' }];
    } }) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'settled-row' }] }) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          if (opts.stampFails) throw new Error('stamp failed');
          writes.push(`stamp:${String(v.githubPrNumber)}`);
        },
      }),
    }),
  };
  const db = { transaction: async (work: (t: typeof tx) => Promise<unknown>) => work(tx), insert: outside, update: outside };
  return { db: db as never, writes, outside };
}

describe('recordTaskPullRequest', () => {
  it('writes the row and the stamp through the transaction handle, and returns the row', async () => {
    const { db, writes, outside } = fakeDb();
    expect(await recordTaskPullRequest(db, { ...input, platformDraftExecutionId: 42 })).toEqual({ id: 'row-1', written: true });
    expect(writes).toEqual(['insert:draft:42', 'stamp:7']);
    expect(outside).not.toHaveBeenCalled();
  });

  it('regression: a row the reconciler already settled (merged/closed) is returned untouched and the task is NOT stamped', async () => {
    const { db, writes } = fakeDb({ settled: true });
    expect(await recordTaskPullRequest(db, input)).toEqual({ id: 'settled-row', written: false });
    expect(writes).toEqual([]);
  });

  it('regression: M1 -a failed stamp rejects the whole write (the caller sees the partial write, not a half-recorded PR)', async () => {
    const { db, outside } = fakeDb({ stampFails: true });
    await expect(recordTaskPullRequest(db, input)).rejects.toThrow('stamp failed');
    expect(outside).not.toHaveBeenCalled();
  });
});

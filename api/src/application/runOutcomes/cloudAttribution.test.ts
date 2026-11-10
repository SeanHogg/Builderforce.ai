import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { cloudRunAttributions, recordCloudRunAttributions } from './cloudAttribution';

const committedAt = new Date('2026-10-18T00:00:00.000Z');
const run = { taskId: 12, executionId: 345, branch: 'builderforce/task-12', committedAt };
const commit = (sha: string, message: string) => ({ sha, message, authorName: 'BuilderForce' });

describe('cloud run commit attribution', () => {
  it('keeps exactly this run\'s commits and reads each one\'s path from its subject', () => {
    const rows = cloudRunAttributions([
      commit('AAA1111', 'Add src/a.ts — task #12 · run #345 (Coder)'),
      commit('bbb2222', 'Edit src/b.ts — task #12 · run #345 (Coder)'),
      commit('ccc3333', 'Add src/c.ts — task #12 · run #344 (Coder)'),   // an earlier run of the task
      commit('ddd4444', 'Add src/d.ts — task #12 (Coder)'),             // written before per-run subjects
      commit('eee5555', 'Fix typo'),                                    // a human's commit
    ], run);
    expect(rows).toEqual([
      { commitSha: 'aaa1111', path: 'src/a.ts', branch: 'builderforce/task-12', addedLines: null, committedAt, source: 'cloud-finalize' },
      { commitSha: 'bbb2222', path: 'src/b.ts', branch: 'builderforce/task-12', addedLines: null, committedAt, source: 'cloud-finalize' },
    ]);
  });

  it('attributes nothing to a removal (no content of the run is in it)', () => {
    expect(cloudRunAttributions([commit('fff6666', 'Remove src/x.ts — task #12 · run #345 (Coder) — obsolete')], run)).toEqual([]);
  });

  it('writes under the cloud run id and the remote-style repository identity', async () => {
    const db = fakeDb([[]]);
    const repoCtx = { provider: 'github', host: null, owner: 'acme', repo: 'app', branch: 'builderforce/task-12' } as unknown as TicketRepoContext;
    const n = await recordCloudRunAttributions(db as unknown as Db, {
      tenantId: 7, executionId: 345, taskId: 12, repoCtx, now: committedAt,
      commits: [commit('aaa1111', 'Add src/a.ts — task #12 · run #345 (Coder)')],
    });
    expect(n).toBe(1);
    const insert = db.calls.find((c) => c.kind === 'insert');
    expect(insert?.payload).toEqual([expect.objectContaining({
      tenantId: 7, runId: 'cloud:345', repository: 'https://github.com/acme/app', commitSha: 'aaa1111', path: 'src/a.ts', source: 'cloud-finalize',
    })]);
  });

  it('writes nothing when the run has no commits of its own', async () => {
    const db = fakeDb();
    expect(await recordCloudRunAttributions(db as unknown as Db, {
      tenantId: 7, executionId: 345, taskId: 12, repoCtx: { provider: 'github', host: null, owner: 'a', repo: 'b', branch: 'x' } as unknown as TicketRepoContext,
      commits: [commit('eee5555', 'Fix typo')],
    })).toBe(0);
    expect(db.calls).toHaveLength(0);
  });
});

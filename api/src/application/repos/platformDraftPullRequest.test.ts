/**
 * The durable record of a platform-opened draft: a `draft` row on the task's branch that the task's PR stamp names.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/database/tenantScope', () => ({ scopedToTenant: () => ({}) }));

import { findPlatformDraftPullRequest } from './platformDraftPullRequest';

/** A db whose first select answers the draft rows and whose second answers the task's PR stamp. */
function fakeDb(rows: Array<{ id: string; number: number | null; url: string | null }>, stamp: number | null) {
  const answers = [rows, stamp === null ? [] : [{ number: stamp }]];
  return {
    select: () => {
      const answer = answers.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(answer).then(res);
      return chain;
    },
  } as never;
}

const a = { tenantId: 1, taskId: 3, repoId: 'repo-1', branch: 'bf/task-3' };
const row = { id: 'r1', number: 7, url: 'https://x/pull/7' };

describe('findPlatformDraftPullRequest', () => {
  it('finds the draft the task\'s stamp names', async () => {
    expect(await findPlatformDraftPullRequest(fakeDb([row], 7), a)).toEqual(row);
  });
  it('is null when the stamp names a different PR', async () => {
    expect(await findPlatformDraftPullRequest(fakeDb([row], 12), a)).toBeNull();
  });
  it('is null with no draft row, or an unstamped task', async () => {
    expect(await findPlatformDraftPullRequest(fakeDb([], 7), a)).toBeNull();
    expect(await findPlatformDraftPullRequest(fakeDb([row], null), a)).toBeNull();
  });
  it('regression: a marked row a human already marked ready (open) is still the run\'s own PR (the marker, not the status, is the identity)', async () => {
    const opened = { ...row, status: 'open' };
    expect(await findPlatformDraftPullRequest(fakeDb([opened], 7), a)).toMatchObject({ number: 7, status: 'open' });
  });
  it('picks the row the stamp names among several', async () => {
    const other = { id: 'r0', number: 5, url: 'https://x/pull/5' };
    expect(await findPlatformDraftPullRequest(fakeDb([other, row], 7), a)).toEqual(row);
  });
});

/**
 * The durable record of a platform-opened draft: a `draft` row on the task's branch that the task's PR stamp names.
 */
import { describe, expect, it, vi } from 'vitest';

const scoped = vi.hoisted(() => ({ conditions: [] as unknown[][] }));
vi.mock('../../infrastructure/database/tenantScope', () => ({ scopedToTenant: (...a: unknown[]) => { scoped.conditions.push(a.slice(2)); return {}; } }));

import { PgDialect } from 'drizzle-orm/pg-core';
import { findPlatformDraftPullRequest, markPlatformDraftOpen, restorePlatformDraft, retirePlatformDraft } from './platformDraftPullRequest';

/** A db whose transaction records each update's table-agnostic `set`, answering the first (pull_requests) update with `matched` rows. */
function txDb(matched: number) {
  const sets: Array<Record<string, unknown>> = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ claimedAt: CLAIM }] }) }) }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        sets.push(s);
        const answer = sets.length === 1 ? Array.from({ length: matched }, () => ({ id: 'r1' })) : [];
        const chain = { where: () => chain, returning: async () => answer, then: (res: (v: unknown) => unknown) => Promise.resolve(answer).then(res) };
        return chain;
      },
    }),
  };
  return { db: { transaction: async (work: (t: typeof tx) => Promise<unknown>) => work(tx) } as never, sets };
}
const CLAIM = new Date('2026-01-01T00:00:00Z');
const retire = { rowId: 'r1', taskId: 3, number: 7, url: 'https://x/pull/7', executionId: 50 };

describe('markPlatformDraftOpen', () => {
  const run = async (executionId?: number) => {
    scoped.conditions.length = 0;
    await markPlatformDraftOpen({ update: () => ({ set: () => ({ where: async () => undefined }) }) } as never, 1, 'r1', true, executionId);
    // the last condition is the marker predicate, rendered with its bound values
    const cond = scoped.conditions[0]!.at(-1);
    return new PgDialect().sqlToQuery(cond as never);
  };

  it('regression: with an executionId the clear is FENCED to that marker (a stale id matches no row)', async () => {
    const q = await run(50);
    expect(q.sql).toContain('"platform_draft_execution_id" = $1');
    expect(q.params).toEqual([50]);
  });

  it('without one it only requires a marker', async () => {
    expect((await run()).sql).toContain('is not null');
  });
});

describe('retirePlatformDraft / restorePlatformDraft', () => {
  it('regression: Minor 4 - the CAS releases the task\'s PR stamp but NOT its open-claim (that waits for the provider close)', async () => {
    const { db, sets } = txDb(1);
    // It hands back the claim it saw inside the transaction: the fence for the caller's later release.
    expect(await retirePlatformDraft(db, 1, retire)).toEqual({ claimedAt: CLAIM });
    expect(sets[1]).toMatchObject({ githubPrUrl: null, githubPrNumber: null });
    expect(sets[1]).not.toHaveProperty('prOpeningAt');
  });
  it('a lost compare-and-set returns null', async () => {
    expect(await retirePlatformDraft(txDb(0).db, 1, retire)).toBeNull();
  });
  it('regression: Minor 5- a restore whose row update matched nothing does not re-stamp the task', async () => {
    const { db, sets } = txDb(0);
    await restorePlatformDraft(db, 1, retire);
    expect(sets).toHaveLength(1);
  });
  it('a restore that matched the row re-stamps the task', async () => {
    const { db, sets } = txDb(1);
    await restorePlatformDraft(db, 1, retire);
    expect(sets[1]).toMatchObject({ githubPrUrl: 'https://x/pull/7', githubPrNumber: 7 });
  });
});

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

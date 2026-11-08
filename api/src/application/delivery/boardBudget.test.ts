/**
 * A board EARNS when a ticket reaches Done: one idempotent `grant` of points on the
 * board's own ledger account. The database is doubled; what matters is the right
 * account, the right amount, the idempotency key, and that an epic earns nothing
 * (its children already did).
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: async (_env: unknown, _key: string, load: () => Promise<unknown>) => load(),
  invalidateCached: vi.fn(async () => undefined),
}));

import { earnBoardBudget } from './boardBudget';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';

const env = {} as Env;

describe('earnBoardBudget', () => {
  it('credits the board its ticket\'s story points, keyed by the ticket', async () => {
    const db = fakeDb([
      [{ boardId: 'board-1', points: 5, taskType: 'task', title: 'Ship it' }], // task ⋈ board
      [{ id: 1 }],                                                              // ledger insert
    ]);

    const credited = await earnBoardBudget(db as unknown as Db, env, { tenantId: 7, taskId: 42 });

    expect(credited).toBe(true);
    expect(db.calls[1]!.payload).toMatchObject({
      tenantId: 7,
      accountKind: 'board',
      accountRef: 'board-1',
      denomination: 'points',
      entryKind: 'grant',
      amount: '5',
      reference: 'board-earn:42',
    });
    expect(invalidateCached).toHaveBeenCalled();
  });

  it('earns one point for an unestimated ticket', async () => {
    const db = fakeDb([[{ boardId: 'board-1', points: null, taskType: 'task', title: 'x' }], [{ id: 1 }]]);
    await earnBoardBudget(db as unknown as Db, env, { tenantId: 7, taskId: 43 });
    expect(db.calls[1]!.payload).toMatchObject({ amount: '1' });
  });

  it('pays once: a replayed reference credits nothing', async () => {
    const db = fakeDb([[{ boardId: 'board-1', points: 2, taskType: 'task', title: 'x' }], []]);
    expect(await earnBoardBudget(db as unknown as Db, env, { tenantId: 7, taskId: 44 })).toBe(false);
  });

  it('earns nothing for an epic, whose children already paid', async () => {
    const db = fakeDb([[{ boardId: 'board-1', points: 8, taskType: 'epic', title: 'Epic' }]]);
    expect(await earnBoardBudget(db as unknown as Db, env, { tenantId: 7, taskId: 45 })).toBe(false);
    expect(db.calls).toHaveLength(1);
  });

  it('earns nothing for a ticket whose project has no board', async () => {
    const db = fakeDb([[]]);
    expect(await earnBoardBudget(db as unknown as Db, env, { tenantId: 7, taskId: 46 })).toBe(false);
  });
});

describe('regression: reopen then re-close earns once', () => {
  it('regression: closing, reopening and re-closing a ticket credits the board a single time', async () => {
    vi.mocked(invalidateCached).mockClear();
    const row = { boardId: 'board-1', points: 3, taskType: 'task', title: 'Reopened' };
    const db = fakeDb([
      [row], [{ id: 1 }], // first close: credited
      [row], [],          // re-close: same reference, ledger conflict -> nothing inserted
    ]);
    const first = await earnBoardBudget(db as unknown as Db, env, { tenantId: 7, taskId: 50 });
    const second = await earnBoardBudget(db as unknown as Db, env, { tenantId: 7, taskId: 50 });
    expect([first, second]).toEqual([true, false]);
    // Both attempts used the SAME idempotency key, so the ledger can dedupe them.
    const refs = db.calls.filter((c) => c.kind === 'insert').map((c) => (c.payload as { reference: string }).reference);
    expect(refs).toEqual(['board-earn:50', 'board-earn:50']);
    expect(invalidateCached).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpBoardLive, invalidateBoardLanesCache, readBoardDispatches, readBoardLanesCached, readBoardTickets } from './boardReads';

/**
 * The polled board reads: each costs ONE statement cold when the board has rows (the
 * board-exists check rides the main join), at most two when it is empty, and zero when
 * nothing moved; the writers' bump / invalidation orphans exactly what they changed.
 */

/** Selects resolve in CALL order. */
function fakeDb(batches: unknown[][]) {
  let selects = 0;
  const db = {
    select: () => {
      const rows = batches[selects] ?? [];
      selects += 1;
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject);
      return chain;
    },
  } as unknown as Db;
  return { db, selects: () => selects };
}

function fakeEnv() {
  const store = new Map<string, string>();
  const kv = {
    get: vi.fn(async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null)),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
  return { env: { AUTH_CACHE_KV: kv } as unknown as Env };
}

const DISPATCH = { id: 'd1', ticketRunId: 't1', taskId: 1, status: 'running' };

describe('readBoardDispatches', () => {
  it('is one statement cold and zero on an unchanged poll', async () => {
    const { env } = fakeEnv();
    const { db, selects } = fakeDb([[DISPATCH]]);

    expect(await readBoardDispatches(env, db, 1, 'b1')).toEqual([DISPATCH]);
    expect(selects()).toBe(1);
    expect(await readBoardDispatches(env, db, 1, 'b1')).toEqual([DISPATCH]);
    expect(selects()).toBe(1);
  });

  it('re-reads after a dispatch or ticket-run writer bumps the tenant token', async () => {
    const { env } = fakeEnv();
    const { db, selects } = fakeDb([[DISPATCH], [{ ...DISPATCH, status: 'completed' }]]);

    await readBoardDispatches(env, db, 1, 'b1');
    await bumpBoardLive(1, env);
    const next = await readBoardDispatches(env, db, 1, 'b1');
    expect(next?.[0]?.status).toBe('completed');
    expect(selects()).toBe(2);
  });

  it('does not re-read for another tenant write', async () => {
    const { env } = fakeEnv();
    const { db, selects } = fakeDb([[DISPATCH]]);

    await readBoardDispatches(env, db, 1, 'b1');
    await bumpBoardLive(2, env);
    await readBoardDispatches(env, db, 1, 'b1');
    expect(selects()).toBe(1);
  });

  it('tells "no dispatches yet" from "no such board" with a second statement only when empty', async () => {
    const { env } = fakeEnv();
    const known = fakeDb([[], [{ id: 'b1' }]]);
    expect(await readBoardDispatches(env, known.db, 1, 'b1')).toEqual([]);
    expect(known.selects()).toBe(2);

    const unknown = fakeDb([[], []]);
    expect(await readBoardDispatches(env, unknown.db, 1, 'nope')).toBeNull();
  });
});

describe('readBoardTickets', () => {
  it('is cached behind the same token as dispatches', async () => {
    const { env } = fakeEnv();
    const { db, selects } = fakeDb([[{ id: 't1', lifecycle: 'queued' }], [{ id: 't1', lifecycle: 'done' }]]);

    await readBoardTickets(env, db, 1, 'b1');
    await readBoardTickets(env, db, 1, 'b1');
    expect(selects()).toBe(1);
    await bumpBoardLive(1, env);
    expect((await readBoardTickets(env, db, 1, 'b1'))?.[0]).toMatchObject({ lifecycle: 'done' });
  });
});

describe('readBoardLanesCached', () => {
  it('is one statement for the board check AND the lanes, then cached until a lane writer invalidates', async () => {
    const { env } = fakeEnv();
    const { db, selects } = fakeDb([
      [{ lane: { id: 'l1', key: 'todo' } }, { lane: { id: 'l2', key: 'done' } }],
      [{ lane: { id: 'l1', key: 'todo' } }],
    ]);

    expect(await readBoardLanesCached(env, db, 1, 'b1')).toHaveLength(2);
    expect(await readBoardLanesCached(env, db, 1, 'b1')).toHaveLength(2);
    expect(selects()).toBe(1);

    await invalidateBoardLanesCache(env, 1, 'b1');
    expect(await readBoardLanesCached(env, db, 1, 'b1')).toHaveLength(1);
    expect(selects()).toBe(2);
  });

  it('reads a board with no lanes as an empty list, and an unknown board as null', async () => {
    const { env } = fakeEnv();
    expect(await readBoardLanesCached(env, fakeDb([[{ lane: null }]]).db, 1, 'empty')).toEqual([]);
    expect(await readBoardLanesCached(env, fakeDb([[]]).db, 1, 'nope')).toBeNull();
  });
});

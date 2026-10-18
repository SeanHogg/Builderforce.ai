import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpExecutionState } from '../runtime/executionStateVersion';
import { bumpChatStructure } from './chatCacheVersions';

vi.mock('./chatAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chatAccess')>()),
  resolveChatAccess: vi.fn(),
}));

import { resolveChatAccess } from './chatAccess';
import { readChatRunHistory, readChatRunHistoryCached } from './chatRunHistory';

/**
 * The polled `GET /chats/:id/runs` read: an unchanged poll must cost NO statement (the
 * access verdict is inside the cached value), a cold read must stay at two statements
 * (runs with titles/host/agent joined in, plus live sub-agents), and the run-state /
 * chat-structure tokens must orphan the entry.
 */

const RUN = {
  id: 7, taskId: 3, status: 'completed', submittedBy: 'user:u1', source: 'agent',
  cloudAgentRef: 'agent-1', agentHostId: null, payload: null, produced: true, errorMessage: null,
  startedAt: new Date('2026-10-01T00:00:00Z'), completedAt: new Date('2026-10-01T00:01:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
  taskTitle: 'Fix login', hostName: null, agentName: 'Bob', linkedCount: 4,
};

/** Resolves selects in CALL order: the runs query is issued first, the sub-agent read second. */
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

const access = vi.mocked(resolveChatAccess);
beforeEach(() => {
  access.mockReset();
  access.mockResolvedValue({ id: 1, ownerId: 'u1', visibility: 'shared' } as never);
});

describe('readChatRunHistory - statement budget', () => {
  it('reads runs (titles, host and agent names joined in) plus sub-agents in two statements', async () => {
    const { db, selects } = fakeDb([[RUN], []]);
    const history = await readChatRunHistory(db, 1, 1);
    expect(selects()).toBe(2);
    expect(history.linkedRunnableTickets).toBe(4);
    expect(history.runs[0]).toMatchObject({ executionId: 7, taskTitle: 'Fix login', agentName: 'Bob', agentRef: 'agent-1' });
  });

  it('pays one extra count only when the chat has no runs', async () => {
    const { db, selects } = fakeDb([[], [], [{ n: 2 }]]);
    const history = await readChatRunHistory(db, 1, 1);
    expect(selects()).toBe(3);
    expect(history).toMatchObject({ linkedRunnableTickets: 2, runs: [] });
  });
});

describe('readChatRunHistoryCached', () => {
  it('serves an unchanged poll with zero statements, access check included', async () => {
    const { env } = fakeEnv();
    const { db, selects } = fakeDb([[RUN], []]);

    const first = await readChatRunHistoryCached(env, db, 1, 1, 'u1');
    expect(first?.runs).toHaveLength(1);
    expect(selects()).toBe(2);
    expect(access).toHaveBeenCalledTimes(1);

    const second = await readChatRunHistoryCached(env, db, 1, 1, 'u1');
    expect(second).toEqual(first);
    expect(selects()).toBe(2);
    expect(access).toHaveBeenCalledTimes(1);
  });

  it('reloads when a run changes state (the tenant execution-state version)', async () => {
    const { env } = fakeEnv();
    const { db, selects } = fakeDb([[RUN], [], [RUN], []]);

    await readChatRunHistoryCached(env, db, 1, 1, 'u1');
    await bumpExecutionState(env, 1);
    await readChatRunHistoryCached(env, db, 1, 1, 'u1');
    expect(selects()).toBe(4);
  });

  it('reloads when the chat links, agents or members change (the structure token)', async () => {
    const { env } = fakeEnv();
    const { db, selects } = fakeDb([[RUN], [], [RUN], []]);

    await readChatRunHistoryCached(env, db, 1, 1, 'u1');
    await bumpChatStructure(1, env);
    await readChatRunHistoryCached(env, db, 1, 1, 'u1');
    expect(selects()).toBe(4);
  });

  it('never caches a denial, so a later grant is seen at once', async () => {
    const { env } = fakeEnv();
    const { db } = fakeDb([]);
    access.mockResolvedValueOnce(null as never);

    expect(await readChatRunHistoryCached(env, db, 1, 1, 'u2')).toBeNull();
    expect(await readChatRunHistoryCached(env, db, 1, 1, 'u2')).not.toBeNull();
    expect(access).toHaveBeenCalledTimes(2);
  });

  it('keeps one entry per user, so one access verdict is never served to another', async () => {
    const { env } = fakeEnv();
    const { db } = fakeDb([[RUN], [], [RUN], []]);

    await readChatRunHistoryCached(env, db, 1, 1, 'u1');
    await readChatRunHistoryCached(env, db, 1, 1, 'u2');
    expect(access).toHaveBeenCalledTimes(2);
  });
});

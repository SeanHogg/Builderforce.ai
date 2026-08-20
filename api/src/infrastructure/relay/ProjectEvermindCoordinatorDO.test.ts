import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';

/**
 * The coordinator DO had NO test harness at all — the class needs a
 * `DurableObjectState`, R2 and a database, so its maintenance handlers
 * (`/recent`, `/reindex`, `/discard-pending`, `/forget`) were covered only
 * indirectly through application-layer dispatchers that mock them away.
 *
 * The missing piece was a fake `DurableObjectState`. It is small — DO storage is a
 * sorted key-value map with a prefix/reverse/limit list — and once it exists the
 * whole memory-store layer is directly pinnable, including the behaviour this suite
 * exists to protect: **memories are no longer capped at 24**. They live one per
 * storage key, so what the model learned stays auditable and forgettable for as long
 * as it is in the weights.
 */

const mocks = vi.hoisted(() => ({ head: vi.fn(), buildDatabase: vi.fn(() => ({})) }));

vi.mock('@seanhogg/builderforce-memory-engine', () => ({
  EvermindModelPackage: { fromBlob: vi.fn() },
  EvermindLMTrainer: class {},
  BPETokenizer: class {},
  diffCheckpoints: vi.fn(),
}));
vi.mock('../database/connection', () => ({ buildDatabase: mocks.buildDatabase }));
vi.mock('../../application/llm/projectEvermind', () => ({
  getProjectEvermindHead: mocks.head,
  putProjectEvermindVersion: vi.fn(),
  recordProjectEvermindMerge: vi.fn(),
  quarantineProjectEvermind: vi.fn(),
  projectEvermindRef: vi.fn(),
}));
vi.mock('../../application/observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

const { ProjectEvermindCoordinatorDO } = await import('./ProjectEvermindCoordinatorDO');

/**
 * Minimal in-memory `DurableObjectState.storage`.
 *
 * Faithful on the three properties the memory store actually depends on: keys sort
 * lexicographically, `list` honours prefix/reverse/limit, and `end` is an EXCLUSIVE
 * bound (which is what makes the paging cursor work). Anything the DO does not use is
 * deliberately absent rather than stubbed to a lie.
 */
function fakeState() {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async put(keyOrBatch: string | Record<string, unknown>, value?: unknown): Promise<void> {
      if (typeof keyOrBatch === 'string') map.set(keyOrBatch, value);
      else for (const [k, v] of Object.entries(keyOrBatch)) map.set(k, v);
    },
    async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
      if (typeof keyOrKeys === 'string') return map.delete(keyOrKeys);
      let n = 0;
      for (const k of keyOrKeys) if (map.delete(k)) n++;
      return n;
    },
    async list<T>(
      opts: { prefix?: string; reverse?: boolean; limit?: number; start?: string; end?: string } = {},
    ): Promise<Map<string, T>> {
      let keys = [...map.keys()].filter((k) => (opts.prefix ? k.startsWith(opts.prefix) : true));
      if (opts.start !== undefined) keys = keys.filter((k) => k >= opts.start!);
      if (opts.end !== undefined) keys = keys.filter((k) => k < opts.end!); // exclusive
      keys.sort();
      if (opts.reverse) keys.reverse();
      if (opts.limit !== undefined) keys = keys.slice(0, opts.limit);
      return new Map(keys.map((k) => [k, map.get(k) as T]));
    },
    async getAlarm(): Promise<number | null> {
      return alarm;
    },
    async setAlarm(t: number): Promise<void> {
      alarm = t;
    },
  };
  return { state: { storage } as unknown as DurableObjectState, map };
}

const env = { UPLOADS: undefined } as unknown as Env;

const entry = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'text' as const,
  version: 1,
  at: id,
  weight: 1,
  prompt: `task ${id}`,
  text: `learned answer ${id}`,
  ...over,
});

function makeDO() {
  const { state, map } = fakeState();
  const doInstance = new ProjectEvermindCoordinatorDO(state, env);
  return { doInstance, map };
}

const recentUrl = (qs = '') => new Request(`https://coordinator/recent${qs}`);

/** Seed merged memories the way a merge does — through the DO's own record path. */
async function seedMemories(doInstance: InstanceType<typeof ProjectEvermindCoordinatorDO>, ids: number[]) {
  const priv = doInstance as unknown as { recordRecent(e: unknown[]): Promise<void> };
  await priv.recordRecent(ids.map((id) => entry(id)));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.head.mockResolvedValue({ version: 3, ref: 'ref-3', mode: 'connected' });
});

describe('memory store — retention', () => {
  it('keeps EVERY memory, not the last 24', async () => {
    const { doInstance } = makeDO();
    await seedMemories(doInstance, Array.from({ length: 100 }, (_, i) => i + 1));

    const body = (await (await doInstance.fetch(recentUrl('?limit=200'))).json()) as {
      recent: { id: number }[];
      total: number;
    };

    // The old single-value ring capped at RECENT_MAX = 24, so memory #1 was gone the
    // moment #25 landed — still in the weights, still recallable, unauditable.
    expect(body.total).toBe(100);
    expect(body.recent).toHaveLength(100);
    expect(body.recent.map((m) => m.id)).toContain(1);
  });

  it('pages newest-first and hands back a cursor that walks the whole history', async () => {
    const { doInstance } = makeDO();
    await seedMemories(doInstance, Array.from({ length: 30 }, (_, i) => i + 1));

    const first = (await (await doInstance.fetch(recentUrl('?limit=10'))).json()) as {
      recent: { id: number }[];
      nextBefore: number | null;
    };
    expect(first.recent.map((m) => m.id)).toEqual([30, 29, 28, 27, 26, 25, 24, 23, 22, 21]);
    expect(first.nextBefore).toBe(21);

    const second = (await (await doInstance.fetch(recentUrl(`?limit=10&before=${first.nextBefore}`))).json()) as {
      recent: { id: number }[];
      nextBefore: number | null;
    };
    // Strictly older than the cursor — the cursor row is not repeated.
    expect(second.recent.map((m) => m.id)).toEqual([20, 19, 18, 17, 16, 15, 14, 13, 12, 11]);

    const third = (await (await doInstance.fetch(recentUrl(`?limit=10&before=${second.nextBefore}`))).json()) as {
      recent: { id: number }[];
      nextBefore: number | null;
    };
    expect(third.recent.map((m) => m.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(third.nextBefore).toBeNull();
  });

  it('never returns the packed embedding on the inspection surface', async () => {
    const { doInstance } = makeDO();
    const priv = doInstance as unknown as { recordRecent(e: unknown[]): Promise<void> };
    await priv.recordRecent([entry(1, { emb: 'AAAA' })]);

    const body = (await (await doInstance.fetch(recentUrl())).json()) as {
      recent: Record<string, unknown>[];
    };
    expect(body.recent[0]).not.toHaveProperty('emb');
  });
});

describe('migrateLegacyRing', () => {
  it('folds the legacy single-value ring into per-memory keys, once', async () => {
    const { doInstance, map } = makeDO();
    map.set('recent', [entry(3), entry(2), entry(1)]);

    const body = (await (await doInstance.fetch(recentUrl())).json()) as {
      recent: { id: number }[];
      total: number;
    };

    expect(body.total).toBe(3);
    expect(body.recent.map((m) => m.id)).toEqual([3, 2, 1]);
    // The legacy key is gone, so the migration cannot run twice and resurrect
    // memories that were since forgotten.
    expect(map.has('recent')).toBe(false);
  });

  it('gives an id-less legacy entry a stable id from its timestamp', async () => {
    const { doInstance, map } = makeDO();
    map.set('recent', [{ kind: 'text', version: 1, at: 1700, weight: 1, text: 'old' }]);

    const body = (await (await doInstance.fetch(recentUrl())).json()) as { recent: { id: number }[] };
    expect(body.recent[0]!.id).toBe(1700);
  });
});

describe('/forget', () => {
  it('removes the named memories and keeps the count honest', async () => {
    const { doInstance } = makeDO();
    await seedMemories(doInstance, [1, 2, 3, 4, 5]);

    const res = await doInstance.fetch(
      new Request('https://coordinator/forget', { method: 'POST', body: JSON.stringify({ ids: [2, 4] }) }),
    );
    expect(await res.json()).toEqual({ ok: true, forgotten: 2, remaining: 3 });

    const body = (await (await doInstance.fetch(recentUrl())).json()) as { recent: { id: number }[] };
    expect(body.recent.map((m) => m.id)).toEqual([5, 3, 1]);
  });

  it('does not count an id that was never there', async () => {
    const { doInstance } = makeDO();
    await seedMemories(doInstance, [1]);

    const res = await doInstance.fetch(
      new Request('https://coordinator/forget', { method: 'POST', body: JSON.stringify({ ids: [99] }) }),
    );
    expect(await res.json()).toMatchObject({ forgotten: 0, remaining: 1 });
  });

  it('rejects a call with no ids rather than silently forgetting nothing', async () => {
    const { doInstance } = makeDO();
    const res = await doInstance.fetch(new Request('https://coordinator/forget', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
  });
});

describe('/discard-pending', () => {
  it('empties the queue and reports how much it dropped', async () => {
    const { doInstance, map } = makeDO();
    map.set('pending', [{ id: 1 }, { id: 2 }, { id: 3 }]);

    const res = await doInstance.fetch(new Request('https://coordinator/discard-pending', { method: 'POST' }));

    expect(await res.json()).toEqual({ ok: true, discarded: 3 });
    expect(map.get('pending')).toEqual([]);
  });

  it('leaves already-MERGED knowledge alone — it only drops the queue', async () => {
    const { doInstance, map } = makeDO();
    map.set('pending', [{ id: 9 }]);
    await seedMemories(doInstance, [1, 2]);

    await doInstance.fetch(new Request('https://coordinator/discard-pending', { method: 'POST' }));

    const body = (await (await doInstance.fetch(recentUrl())).json()) as { total: number };
    expect(body.total).toBe(2);
  });
});

describe('/reindex', () => {
  it('refuses before the coordinator has any state, rather than reporting success', async () => {
    const { doInstance } = makeDO();
    const res = await doInstance.fetch(new Request('https://coordinator/reindex', { method: 'POST' }));
    expect(res.status).toBe(409);
  });

  it('reports 503 — not a silent no-op — when the model cannot be loaded', async () => {
    const { doInstance, map } = makeDO();
    map.set('meta', { tenantId: 1, projectId: 2 });
    await seedMemories(doInstance, [1, 2]);

    const res = await doInstance.fetch(new Request('https://coordinator/reindex', { method: 'POST' }));

    // UPLOADS is unbound here, so the head artifact is unreachable. A caller must be
    // able to tell "could not reindex" from "reindexed nothing".
    expect(res.status).toBe(503);
  });

  it('is a no-op with nothing learned yet', async () => {
    const { doInstance, map } = makeDO();
    map.set('meta', { tenantId: 1, projectId: 2 });

    const res = await doInstance.fetch(new Request('https://coordinator/reindex', { method: 'POST' }));
    expect(await res.json()).toMatchObject({ ok: true, reindexed: 0, done: true });
  });
});

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

describe('legacy provenance backfill', () => {
  /** A LEGACY row: merged before `distilled`/`skipReason` were recorded at all. */
  const legacy = (id: number, over: Record<string, unknown> = {}) => ({
    id, kind: 'text' as const, version: 1, at: id, weight: 1,
    prompt: `task ${id}`, text: `learned answer ${id}`, ...over,
  });

  /**
   * The grading `evermindLearnedStatus` (packages/brain-ui/src/evermind/learnedStatus.ts)
   * applies. Transcribed here because the API Worker cannot import the UI package — this
   * is what pins the backfill to the reader it is supposed to be materialising.
   */
  const verdict = (e: Record<string, unknown>): string => {
    if (e.kind === 'delta') return 'delta';
    if (e.distilled) return 'distilled';
    if (e.skipReason) return (e.skipReason === 'not_pinned' || e.skipReason === 'legacy') ? 'self' : 'fault';
    const p = typeof e.prompt === 'string' ? e.prompt.trim() : '';
    const t = typeof e.text === 'string' ? e.text.trim() : '';
    return p && t && p === t ? 'fault' : 'self';
  };

  const readRecent = async (doInstance: InstanceType<typeof ProjectEvermindCoordinatorDO>) =>
    ((await (await doInstance.fetch(recentUrl('?limit=200'))).json()) as { recent: Record<string, unknown>[] }).recent;

  it('backfills a legacy row so the reader stops inferring — same verdict, now recorded', async () => {
    const { doInstance, map } = makeDO();
    map.set('mem:000000000001', legacy(1));

    const before = verdict(legacy(1));
    const [row] = await readRecent(doInstance);

    expect(row!.skipReason).toBe('legacy');
    expect(row!.distilled).toBe(false);
    // The whole safety property of this migration: materialising the inference must not
    // re-grade history.
    expect(verdict(row!)).toBe(before);
    expect(verdict(row!)).toBe('self');
  });

  it('marks a legacy ECHO row (text === prompt) as the fault it provably is', async () => {
    const { doInstance, map } = makeDO();
    // A teach-a-task whose pinned teacher produced nothing: all that was left to learn
    // was the question, so the row echoes it back as its own answer.
    map.set('mem:000000000002', legacy(2, { prompt: 'How do I retry?', text: 'How do I retry?' }));

    const [row] = await readRecent(doInstance);

    expect(row!.skipReason).toBe('unknown');
    expect(verdict(row!)).toBe('fault');
  });

  it('leaves an already-provenanced row untouched', async () => {
    const { doInstance, map } = makeDO();
    map.set('mem:000000000003', legacy(3, { distilled: true, teacherModel: 'anthropic/claude' }));
    map.set('mem:000000000004', legacy(4, { distilled: false, skipReason: 'gateway_error', attemptedTeacherModel: 'x/y', skipDetail: '503' }));

    const rows = await readRecent(doInstance);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(4)!.skipReason).toBe('gateway_error'); // NOT overwritten with 'legacy'
    expect(byId.get(3)!.skipReason).toBeUndefined();
    expect(byId.get(3)!.distilled).toBe(true);
  });

  it('says nothing about a pre-diffed delta row — it has no text provenance', async () => {
    const { doInstance, map } = makeDO();
    map.set('mem:000000000005', { id: 5, kind: 'delta', version: 1, at: 5, weight: 1, prompt: 'ticket 5' });

    const [row] = await readRecent(doInstance);
    expect(row!.skipReason).toBeUndefined();
    expect(row!.distilled).toBeUndefined();
    expect(verdict(row!)).toBe('delta');
  });

  it('is idempotent: a completed migration never rewrites a row again', async () => {
    const { doInstance, map } = makeDO();
    map.set('mem:000000000001', legacy(1));

    const first = await readRecent(doInstance);
    expect(first[0]!.skipReason).toBe('legacy');
    expect((map.get('schema') as { provenance?: number }).provenance).toBe(1);

    // A REAL recorded reason landing later must survive every subsequent read — proof
    // the walk is marker-gated rather than re-deriving provenance on each pass.
    map.set('mem:000000000001', { ...(map.get('mem:000000000001') as object), skipReason: 'empty_output' });
    const second = await readRecent(doInstance);
    expect(second[0]!.skipReason).toBe('empty_output');
  });

  it('completes on a COLD DO with nothing stored, and marks itself done', async () => {
    const { doInstance, map } = makeDO();
    const rows = await readRecent(doInstance);
    expect(rows).toEqual([]);
    expect((map.get('schema') as { provenance?: number }).provenance).toBe(1);
  });

  it('is bounded per pass and resumes from its cursor on a long ring', async () => {
    const { doInstance, map } = makeDO();
    // 200 legacy rows > the 128-row batch, so ONE pass cannot finish — which is the
    // point: an unbounded walk here would blow the DO's CPU budget on whichever read
    // happened to touch it first.
    for (let i = 1; i <= 200; i++) map.set(`mem:${String(i).padStart(12, '0')}`, legacy(i));

    await readRecent(doInstance);
    const afterOne = map.get('schema') as { provenance?: number; provenanceCursor?: number };
    expect(afterOne.provenance).toBeUndefined();
    expect(afterOne.provenanceCursor).toBe(73); // 200 - 128 + 1: the oldest row of pass one

    await readRecent(doInstance);
    expect((map.get('schema') as { provenance?: number }).provenance).toBe(1);

    // Every row ends up backfilled, newest and oldest alike.
    const rows = await readRecent(doInstance);
    expect(rows.every((r) => r.skipReason === 'legacy')).toBe(true);
  });

  it('folds the LEGACY RING first, then backfills what it produced', async () => {
    const { doInstance, map } = makeDO();
    map.set('recent', [legacy(2), legacy(1, { prompt: 'same', text: 'same' })]);

    const rows = await readRecent(doInstance);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(map.has('recent')).toBe(false);
    expect(byId.get(2)!.skipReason).toBe('legacy');
    expect(byId.get(1)!.skipReason).toBe('unknown');
  });
});

describe('/contribution — the pollable teach status', () => {
  const post = (path: string, body: unknown) =>
    new Request(`https://coordinator/${path}`, { method: 'POST', body: JSON.stringify(body) });
  const statusOf = async (doInstance: InstanceType<typeof ProjectEvermindCoordinatorDO>, id: number) =>
    (await (await doInstance.fetch(new Request(`https://coordinator/contribution?id=${id}`))).json()) as Record<string, unknown>;

  it('hands back a contribution id at enqueue time, and reports it PENDING', async () => {
    const { doInstance } = makeDO();
    const queued = (await (await doInstance.fetch(post('learn-text', {
      tenantId: 1, projectId: 2, text: 'a run long enough to be trainable text', prompt: 'the ticket',
    }))).json()) as { ok: boolean; contributionId: number };

    // Without an id returned here, a surface has nothing to poll — which is exactly why
    // the console could only ever claim success optimistically.
    expect(queued.ok).toBe(true);
    expect(queued.contributionId).toBe(1);
    expect(await statusOf(doInstance, queued.contributionId)).toMatchObject({ status: 'pending', kind: 'text' });
  });

  it('reports MERGED with the ring provenance once the memory exists', async () => {
    const { doInstance } = makeDO();
    const priv = doInstance as unknown as { recordRecent(e: unknown[]): Promise<void> };
    await priv.recordRecent([entry(4, { version: 9, distilled: true, teacherModel: 'anthropic/claude', emb: 'AAAA' })]);

    const status = await statusOf(doInstance, 4);

    expect(status).toMatchObject({ status: 'merged', version: 9, distilled: true, teacherModel: 'anthropic/claude' });
    // The recall-only embedding is an internal, never part of a status payload.
    expect(status).not.toHaveProperty('emb');
  });

  it('carries the teacher FAULT on a merged row — it learned, just un-distilled', async () => {
    const { doInstance } = makeDO();
    const priv = doInstance as unknown as { recordRecent(e: unknown[]): Promise<void> };
    await priv.recordRecent([entry(5, {
      distilled: false, skipReason: 'gateway_error', skipDetail: 'HTTP 503', attemptedTeacherModel: 'vendor/model',
    })]);

    expect(await statusOf(doInstance, 5)).toMatchObject({
      status: 'merged', distilled: false, skipReason: 'gateway_error', skipDetail: 'HTTP 503', attemptedTeacherModel: 'vendor/model',
    });
  });

  it('reports DROPPED for an id a merge consumed without producing a memory', async () => {
    const { doInstance } = makeDO();
    // Never queued, never stored — a poller must be able to stop, not wait forever.
    expect(await statusOf(doInstance, 77)).toMatchObject({ status: 'dropped' });
  });

  it('rejects a call with no usable id', async () => {
    const { doInstance } = makeDO();
    const res = await doInstance.fetch(new Request('https://coordinator/contribution?id=0'));
    expect(res.status).toBe(400);
  });
});

describe('/learn — the stale-baseVersion guard', () => {
  const learn = (body: unknown) =>
    new Request('https://coordinator/learn', { method: 'POST', body: JSON.stringify(body) });

  it('rejects a delta whose base no longer matches, and names the current head', async () => {
    const { doInstance, map } = makeDO();
    mocks.head.mockResolvedValue({ version: 8, ref: 'ref-8', mode: 'connected' });

    const res = await doInstance.fetch(learn({ tenantId: 1, projectId: 2, diff: 'AAAA', baseVersion: 7 }));

    expect(res.status).toBe(409);
    // The head number is the whole point: a producer cannot rebase without being told
    // what to rebase ONTO. This is the contract the on-prem delta producer recovers on.
    expect(await res.json()).toMatchObject({ ok: false, headVersion: 8 });
    // Nothing was queued — a stale diff must never reach the merge.
    expect(map.get('pending')).toBeUndefined();
  });

  it('accepts the SAME delta once it is rebased onto the current head', async () => {
    const { doInstance } = makeDO();
    mocks.head.mockResolvedValue({ version: 8, ref: 'ref-8', mode: 'connected' });

    const res = await doInstance.fetch(learn({ tenantId: 1, projectId: 2, diff: 'AAAA', baseVersion: 8, label: 'ticket 12' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, queued: 1, contributionId: 1, baseVersion: 8 });
  });

  it('refuses on an unseeded project and on a frozen one, without queueing', async () => {
    const { doInstance, map } = makeDO();

    mocks.head.mockResolvedValue({ version: 0, ref: null, mode: 'connected' });
    expect((await doInstance.fetch(learn({ tenantId: 1, projectId: 2, diff: 'AAAA', baseVersion: 0 }))).status).toBe(409);

    mocks.head.mockResolvedValue({ version: 3, ref: 'ref-3', mode: 'offline-frozen' });
    expect((await doInstance.fetch(learn({ tenantId: 1, projectId: 2, diff: 'AAAA', baseVersion: 3 }))).status).toBe(423);

    expect(map.get('pending')).toBeUndefined();
  });
});

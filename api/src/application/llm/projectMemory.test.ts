import { describe, expect, it, vi } from 'vitest';
import {
  qaCacheKey,
  resolveMemoryAnswer,
  cacheProjectAnswer,
  EVERMIND_ANSWER_MIN_CHARS,
} from './projectMemory';
import type { Env } from '../../env';

// No AUTH_CACHE_KV → getCacheVersion/getOrSetCached fall through to the loader.
const env = {} as Env;

/** db mock whose `.select().from().where()[.limit()]` returns queued result sets in
 *  order. Sequence for an Evermind-first resolve: 1) getProjectFactByKey (cache, limit),
 *  2) resolveEvermindTargets → ide_projects children (awaited where, NO limit),
 *  3) getProjectEvermindHead per candidate (limit). `where()` is awaitable AND chainable.
 *  Also supports the upsert chain for cacheProjectAnswer. */
function memoryDb(resultQueue: Array<Array<Record<string, unknown>>>) {
  let i = 0;
  const next = () => resultQueue[i++] ?? [];
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = next();
          const thenable = Promise.resolve(rows) as Promise<unknown> & { limit: () => Promise<unknown> };
          thenable.limit = async () => rows;
          return thenable;
        },
      }),
    }),
    insert,
  } as never;
  return { db, insert, values, onConflictDoUpdate };
}

const headRow = (over: Record<string, unknown> = {}) => ({
  version: 3,
  inferenceEnabled: true,
  name: 'Project Evermind',
  mode: 'connected',
  contributions: 0,
  teacherModel: null,
  lastLearnedAt: null,
  ...over,
});

describe('qaCacheKey', () => {
  it('is deterministic and normalizes case/spacing/punctuation to the same key', () => {
    const a = qaCacheKey('How does auth work?');
    expect(a).toMatch(/^qa:[0-9a-f]{8}$/);
    expect(qaCacheKey('  how   DOES auth WORK ')).toBe(a); // punctuation + case + spacing folded
    expect(qaCacheKey('how does auth work')).toBe(a);
  });
  it('maps genuinely different questions to different keys', () => {
    expect(qaCacheKey('what is the db client')).not.toBe(qaCacheKey('how does auth work'));
  });
});

describe('resolveMemoryAnswer', () => {
  it('returns the cached answer (source qa-cache) on an exact repeat — no Evermind call', async () => {
    const { db } = memoryDb([[{ content: 'Auth uses PKCE OAuth via the gateway.' }]]);
    const runEvermind = vi.fn(async () => 'should not be called');
    const ans = await resolveMemoryAnswer(env, db, 7, 42, 'How does auth work?', { runEvermind });
    expect(ans).toEqual({ text: 'Auth uses PKCE OAuth via the gateway.', source: 'qa-cache' });
    expect(runEvermind).not.toHaveBeenCalled();
  });

  it('falls to Evermind on a cache miss and names WHICH Evermind answered', async () => {
    // cache miss, ide_projects children (none), head for proj 42.
    const { db } = memoryDb([[], [], [headRow()]]);
    const runEvermind = vi.fn(async () => 'This is a sufficiently long Evermind reply about the project.');
    const ans = await resolveMemoryAnswer(env, db, 7, 42, 'How does auth work?', { runEvermind });
    expect(ans?.source).toBe('evermind');
    expect(ans?.evermindVersion).toBe(3);
    expect(ans?.evermindProjectId).toBe(42); // triage: which Evermind
    expect(runEvermind).toHaveBeenCalledTimes(1);
  });

  it('returns null when Evermind is not opted in (inferenceEnabled false)', async () => {
    const { db } = memoryDb([[], [], [headRow({ inferenceEnabled: false })]]);
    const runEvermind = vi.fn(async () => 'a substantive answer that would otherwise qualify');
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'q?', { runEvermind })).toBeNull();
    expect(runEvermind).not.toHaveBeenCalled();
  });

  it('returns null when the Evermind reply is too short (below threshold)', async () => {
    const { db } = memoryDb([[], [], [headRow()]]);
    const runEvermind = vi.fn(async () => 'nope'); // < EVERMIND_ANSWER_MIN_CHARS
    expect('nope'.length).toBeLessThan(EVERMIND_ANSWER_MIN_CHARS);
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'q?', { runEvermind })).toBeNull();
  });

  it('returns null without runEvermind and no cache hit (caller proceeds to the LLM)', async () => {
    const { db } = memoryDb([[]]);
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'q?', {})).toBeNull();
  });
});

describe('cacheProjectAnswer', () => {
  it('write-through upserts a substantive answer under the qa cache key', async () => {
    const { db, insert, onConflictDoUpdate } = memoryDb([]);
    await cacheProjectAnswer(env, db, 7, 42, 'How does auth work?', 'Auth uses PKCE OAuth via the gateway.');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1); // replace-on-write
  });

  it('skips trivially short answers (nothing worth caching)', async () => {
    const { db, insert } = memoryDb([]);
    await cacheProjectAnswer(env, db, 7, 42, 'q?', 'short');
    expect(insert).not.toHaveBeenCalled();
  });
});

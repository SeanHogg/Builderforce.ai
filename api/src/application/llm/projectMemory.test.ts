import { describe, expect, it, vi } from 'vitest';
import {
  qaCacheKey,
  resolveMemoryAnswer,
  cacheProjectAnswer,
  looksLikeCoherentText,
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

  it('returns null when an under-trained head returns long-but-incoherent garbage', async () => {
    const { db } = memoryDb([[], [], [headRow()]]);
    // The real serving failure: fluent-looking gibberish that clears 20 chars but is
    // not language — must be treated as a miss, not served to the user.
    const garbage =
      '� `` **ARserting yoularmy dir this your sintens byy b I - A met toades misin the ge simpelying e the the isb wonvert bled a suchrech u me toan I mend in the you reper seArrading';
    const runEvermind = vi.fn(async () => garbage);
    expect(garbage.length).toBeGreaterThanOrEqual(EVERMIND_ANSWER_MIN_CHARS);
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'status?', { runEvermind })).toBeNull();
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

  it('never caches long-but-incoherent garbage (would pin gibberish under the key)', async () => {
    const { db, insert } = memoryDb([]);
    await cacheProjectAnswer(env, db, 7, 42, 'status?', 'commit commit commit ticket ticketO commit PRge the the inten prousan syour');
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('looksLikeCoherentText', () => {
  it('rejects the observed under-trained-Evermind garbage samples', () => {
    // Sample 1 — includes the Unicode replacement char from broken byte-level decode.
    expect(
      looksLikeCoherentText(
        '� `` **ARserting yoularmy dir this your sintens byy b I - A met toades misin the ge simpelying e the the isb wonvert',
      ),
    ).toBe(false);
    // Sample 2 — no replacement char, but degenerate "commit" repetition + stray letters.
    expect(
      looksLikeCoherentText(
        'S cane syour commitemend commiting ete the inten you commits : The commete eg in the commit commit commit ticket ticketO commit PRge in the in the k y i o y',
      ),
    ).toBe(false);
  });

  it('accepts normal English answers (no false rejects)', () => {
    expect(looksLikeCoherentText('The project status is green: all 12 tickets are on track and the last deploy passed CI.')).toBe(true);
    expect(looksLikeCoherentText('Auth uses PKCE OAuth via the gateway; the tenant key is stored in SecretStorage.')).toBe(true);
    // Short clean answers clear it (too few tokens to score structurally).
    expect(looksLikeCoherentText('Yes, the build is green.')).toBe(true);
  });

  it('does not mis-reject legitimate non-English replies', () => {
    // Spanish uses real one-letter words (y / o); the single-letter test must not fire.
    expect(looksLikeCoherentText('El estado del proyecto es verde y todas las tareas están al día o casi.')).toBe(true);
    // CJK has no ASCII letters to score — accepted.
    expect(looksLikeCoherentText('项目状态为绿色，所有工单都按计划进行，最近一次部署已通过持续集成。')).toBe(true);
  });

  it('rejects empty / whitespace', () => {
    expect(looksLikeCoherentText('')).toBe(false);
    expect(looksLikeCoherentText('   ')).toBe(false);
  });
});

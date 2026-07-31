import { describe, expect, it, vi } from 'vitest';
import {
  formatProjectFactsBlock,
  recallProjectFacts,
  upsertProjectFact,
  buildProjectFactsBlock,
} from './projectFacts';
import type { Env } from '../../env';

// No AUTH_CACHE_KV → getCacheVersion/getOrSetCached fall through to the loader.
const env = {} as Env;

/** db mock for recall: `.select().from().where().orderBy().limit()` → rows. */
function recallDb(rows: Array<{ key: string; content: string }>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    }),
  } as never;
}

/** db mock for upsert: records the onConflictDoUpdate call so we can assert it fired. */
function upsertDb() {
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  return { db: { insert } as never, insert, values, onConflictDoUpdate };
}

describe('formatProjectFactsBlock', () => {
  it('returns empty string when there are no facts', () => {
    expect(formatProjectFactsBlock([])).toBe('');
  });
  it('formats facts as a labelled bullet block', () => {
    const block = formatProjectFactsBlock([
      { key: 'auth', content: 'Auth uses PKCE OAuth.' },
      { key: 'pkg', content: 'db client is drizzle.' },
    ]);
    expect(block).toContain('[Project memory');
    expect(block).toContain('- Auth uses PKCE OAuth.');
    expect(block).toContain('- db client is drizzle.');
  });
});

describe('upsertProjectFact (write-through)', () => {
  it('upserts by (tenant, project, key) and returns true', async () => {
    const m = upsertDb();
    const ok = await upsertProjectFact(env, m.db, 7, 42, 'auth-flow', 'PKCE OAuth', 'vscode');
    expect(ok).toBe(true);
    expect(m.insert).toHaveBeenCalledTimes(1);
    expect(m.onConflictDoUpdate).toHaveBeenCalledTimes(1); // replace-on-write, not append
  });

  it('is a no-op (no DB write) for an invalid project or empty content', async () => {
    const m = upsertDb();
    expect(await upsertProjectFact(env, m.db, 7, 0, 'k', 'v')).toBe(false);
    expect(await upsertProjectFact(env, m.db, 7, 42, 'k', '   ')).toBe(false);
    expect(m.insert).not.toHaveBeenCalled();
  });
});

describe('recallProjectFacts', () => {
  it('returns the store rows for a valid project', async () => {
    const facts = await recallProjectFacts(env, recallDb([{ key: 'a', content: 'x' }]), 7, 42, { query: 'x' });
    expect(facts).toEqual([{ key: 'a', content: 'x' }]);
  });
  it('returns [] for an invalid project id (no query needed)', async () => {
    expect(await recallProjectFacts(env, recallDb([{ key: 'a', content: 'x' }]), 7, 0)).toEqual([]);
  });
});

describe('buildProjectFactsBlock', () => {
  it('recalls + formats in one call', async () => {
    const block = await buildProjectFactsBlock(env, recallDb([{ key: 'a', content: 'shared fact' }]), 7, 42, 'q');
    expect(block).toContain('- shared fact');
  });
});

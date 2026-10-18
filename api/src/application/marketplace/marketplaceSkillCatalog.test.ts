import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/marketplace/skills` and `/api/v1/skills` list the published catalogue through
 * ONE cached reader. Pins the cache key (version token + clamped paging) and that
 * neither route carries its own copy of the query again.
 */

const getOrSetCached = vi.fn(async (_env: unknown, _key: string, _load: () => unknown) => ({ skills: [], total: 0, page: 1, limit: 24 }));
const getCacheVersion = vi.fn(async () => 7);
const bumpCacheVersion = vi.fn(async () => {});
vi.mock('../../infrastructure/cache/readThroughCache', () => ({ getOrSetCached, getCacheVersion, bumpCacheVersion }));

const { listPublishedSkills, invalidateSkillsList } = await import('./marketplaceSkillCatalog');

const env = {} as never;
const db = {} as never;

beforeEach(() => getOrSetCached.mockClear());

describe('listPublishedSkills', () => {
  it('keys the cache on the version token and clamped paging', async () => {
    await listPublishedSkills(env, db, { category: 'dev', q: 'git', page: '0', limit: '500' });
    expect(getOrSetCached.mock.calls[0]?.[1]).toBe('mp:skills:list:v:7:c=dev:q=git:p=1:l=100');
  });

  it('a skill write orphans every cached page by bumping the token', async () => {
    await invalidateSkillsList(env);
    expect(bumpCacheVersion).toHaveBeenCalledWith(env, 'marketplace:skills:list');
  });
});

describe('one published-skill list query', () => {
  it.each([
    'presentation/routes/marketplaceRoutes.ts',
    'presentation/routes/publicApiRoutes.ts',
  ])('%s lists through the catalogue', (relative) => {
    const source = readFileSync(join(__dirname, '../..', relative), 'utf8');
    expect(source).toContain('listPublishedSkills(');
    expect(source).not.toContain('skillSearchMatches(');
  });
});

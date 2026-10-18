/**
 * readDora is the ONE cached DORA read behind /api/insights/dora and /api/members/dora:
 * it reads through the version-keyed `doraCacheKey`, so both routes share one entry and
 * a deploy (which bumps the workforce version) refreshes both at once.
 */
import { describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({
  getOrSetCached: vi.fn(async (_env: unknown, key: string, _fn: () => unknown) => (key.includes(':ver:') ? 4 : { servedFrom: key })),
  invalidateCached: vi.fn(),
}));
vi.mock('../../infrastructure/cache/readThroughCache', () => cache);

import { doraCacheKey, readDora } from './workforceMetrics';

describe('readDora', () => {
  it('reads through the version-keyed DORA cache entry', async () => {
    const out = await readDora({} as never, {} as never, 7, 30, 2);
    expect(out).toEqual({ servedFrom: doraCacheKey(7, 4, 30, 2) });
  });

  it('keys the workspace-wide read apart from a project read', () => {
    expect(doraCacheKey(7, 4, 30)).not.toBe(doraCacheKey(7, 4, 30, 2));
  });
});

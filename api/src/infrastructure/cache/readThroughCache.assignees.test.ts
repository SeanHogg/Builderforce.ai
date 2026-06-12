import { describe, expect, it, vi } from 'vitest';
import { getOrSetCached, invalidateCached } from './readThroughCache';
import type { Env } from '../../env';

/**
 * Locks the gap [1249] fix: invalidating the task-assignees cache key forces the
 * next GET /api/tasks/assignees read to re-run its loader, so a freshly added (or
 * removed) teammate appears immediately instead of after the 5-min KV TTL.
 *
 * Uses an in-memory stand-in for AUTH_CACHE_KV so the L2 layer is exercised too;
 * each case uses a distinct tenant id to stay isolated from the module-level L1.
 */

function mockKvEnv(): Env {
  const store = new Map<string, string>();
  return {
    AUTH_CACHE_KV: {
      get: vi.fn(async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null)),
      put: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      delete: vi.fn(async (k: string) => {
        store.delete(k);
      }),
    },
  } as unknown as Env;
}

describe('task-assignees cache invalidation', () => {
  it('re-runs the loader after the membership key is invalidated', async () => {
    const env = mockKvEnv();
    const key = 'task-assignees:tenant:91249';

    const loader = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a', name: 'Ada' }])
      .mockResolvedValueOnce([
        { id: 'a', name: 'Ada' },
        { id: 'b', name: 'Bo' },
      ]);

    // First read populates both layers.
    expect(await getOrSetCached(env, key, loader)).toEqual([{ id: 'a', name: 'Ada' }]);
    // Cached read — loader not called again.
    expect(await getOrSetCached(env, key, loader)).toEqual([{ id: 'a', name: 'Ada' }]);
    expect(loader).toHaveBeenCalledTimes(1);

    // Membership change invalidates the key (the gap [1249] fix).
    await invalidateCached(env, key);

    // Next read re-loads and sees the new teammate.
    expect(await getOrSetCached(env, key, loader)).toEqual([
      { id: 'a', name: 'Ada' },
      { id: 'b', name: 'Bo' },
    ]);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

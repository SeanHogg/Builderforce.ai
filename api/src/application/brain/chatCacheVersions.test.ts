import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import { bumpUnreadForChatAudience, unreadUserKey } from './chatCacheVersions';

function envWithDeletes() {
  const deleted: string[] = [];
  const env = {
    AUTH_CACHE_KV: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async (key: string) => { deleted.push(key); }),
    },
  } as unknown as Env;
  return { env, deleted };
}

function dbAudience(users: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: async () => users.map((userId) => ({ userId })),
      }),
    }),
  } as unknown as Db;
}

describe('bumpUnreadForChatAudience', () => {
  beforeEach(() => __clearL1CacheForTests());

  it('bumps only the users returned for that chat', async () => {
    const { env, deleted } = envWithDeletes();
    await bumpUnreadForChatAudience(dbAudience(['alice']), 7, 42, env);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain(unreadUserKey(7, 'alice'));
  });

  it('is a no-op when nobody has a read-state row', async () => {
    const { env, deleted } = envWithDeletes();
    await bumpUnreadForChatAudience(dbAudience([]), 7, 42, env);
    expect(deleted).toEqual([]);
  });
});

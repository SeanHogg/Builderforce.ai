import { beforeEach, describe, expect, it, vi } from 'vitest';

const owned = vi.hoisted(() => ({ chats: new Set<number>(), tasks: new Set<number>(), projects: new Set<number>(), keys: [] as string[] }));

vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => ({}) }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: async (_env: unknown, key: string, load: () => Promise<unknown>) => {
    owned.keys.push(key);
    return load();
  },
}));
vi.mock('../brain/brainChatGuards', () => ({ chatInTenant: async (_db: unknown, _t: number, id: number) => owned.chats.has(id) }));
vi.mock('../../infrastructure/database/tenantScope', () => ({ taskInTenant: async (_db: unknown, id: number) => owned.tasks.has(id) }));
vi.mock('../project/projectOwnership', () => ({ projectInTenant: async (_db: unknown, _t: number, id: number) => owned.projects.has(id) }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: () => undefined }));

import { readUsageWorkHints, resolveUsageWorkHints, withVerifiedChat } from './usageWorkHints';
import type { Env } from '../../env';

const env = {} as Env;

beforeEach(() => {
  owned.chats.clear();
  owned.tasks.clear();
  owned.projects.clear();
  owned.keys.length = 0;
});

describe('readUsageWorkHints — chat attribution (PRD 36, D2)', () => {
  it('reads metadata.chatId, then brainChatId, with the header first', () => {
    expect(readUsageWorkHints(() => undefined, { chatId: 5 }).chatId).toBe(5);
    expect(readUsageWorkHints(() => undefined, { brainChatId: 6 }).chatId).toBe(6);
    expect(readUsageWorkHints((name) => (name === 'x-builderforce-chat-id' ? '7' : undefined), { chatId: 5 }).chatId).toBe('7');
  });
});

describe('resolveUsageWorkHints — chat ownership', () => {
  it('keeps a chat of this tenant, cached under its own key', async () => {
    owned.chats.add(12);
    expect(await resolveUsageWorkHints(env, 3, { chatId: 12 })).toEqual({ chatId: 12 });
    expect(owned.keys).toEqual(['usagehint:chat:3:12']);
  });

  it('drops a chat number that is not this tenant’s (a device-local id)', async () => {
    expect(await resolveUsageWorkHints(env, 3, { chatId: 5 })).toEqual({});
  });

  it('drops malformed ids without a lookup', async () => {
    expect(await resolveUsageWorkHints(env, 3, { chatId: -1 })).toEqual({});
    expect(await resolveUsageWorkHints(env, 3, { chatId: 'abc' })).toEqual({});
    expect(owned.keys).toEqual([]);
  });
});

describe('withVerifiedChat', () => {
  it('strips an unproven chatId / brainChatId and keeps everything else', () => {
    const meta = { chatId: 5, brainChatId: 5, mode: 'work', projectId: 2 };
    expect(withVerifiedChat(meta, {})).toEqual({ mode: 'work', projectId: 2 });
    expect(meta.chatId).toBe(5); // the caller's object is not mutated
  });

  it('returns the same object when the chat was proven or none was named', () => {
    const proven = { chatId: 12, mode: 'chat' };
    expect(withVerifiedChat(proven, { chatId: 12 })).toBe(proven);
    const none = { mode: 'chat' };
    expect(withVerifiedChat(none, {})).toBe(none);
    expect(withVerifiedChat(null, {})).toBeNull();
  });

  it('strips a metadata chat that disagrees with the proven one', () => {
    expect(withVerifiedChat({ chatId: 5 }, { chatId: 12 })).toEqual({});
  });
});

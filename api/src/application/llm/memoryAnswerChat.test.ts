import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('../brain/chatAccess', () => ({ resolveChatAccess: mocks.access }));
vi.mock('./usageLedger', () => ({ usageDatabaseOf: (db: unknown) => db }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { ANSWER_ORIGIN_WINDOW_MS, chatAnswerOrigin, parseAnswerChatId, resolveAnswerChat } from './memoryAnswerChat';

/** `.select().from().where().orderBy().limit()` → rows, recording the where clause. */
function usageDb(rows: unknown[] | Error) {
  const seen: { where?: unknown } = {};
  const db = {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          seen.where = w;
          return {
            orderBy: () => ({
              limit: () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)),
            }),
          };
        },
      }),
    }),
  } as unknown as Db;
  return { db, seen };
}

beforeEach(() => vi.clearAllMocks());

describe('parseAnswerChatId', () => {
  it('accepts only a positive server chat id', () => {
    expect(parseAnswerChatId('7')).toBe(7);
    expect(parseAnswerChatId(7)).toBe(7);
    expect(parseAnswerChatId('-3')).toBeNull();
    expect(parseAnswerChatId('abc')).toBeNull();
    expect(parseAnswerChatId(undefined)).toBeNull();
    expect(parseAnswerChatId('')).toBeNull();
  });
});

describe('resolveAnswerChat', () => {
  it('goes through the shared chat-access guard, tenant + person scoped', async () => {
    mocks.access.mockResolvedValue({ id: 7, ownerId: 'u1', visibility: 'shared', memoryEnabled: false });
    const db = {} as Db;
    expect(await resolveAnswerChat(db, { tenantId: 3, userId: 'u1', chatId: 7 })).toEqual({ chatId: 7, memoryEnabled: false });
    expect(mocks.access).toHaveBeenCalledWith(db, expect.objectContaining({ chatId: 7, tenantId: 3, userId: 'u1' }));
  });

  it('is null for a chat the caller cannot access', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await resolveAnswerChat({} as Db, { tenantId: 3, userId: 'u1', chatId: 7 })).toBeNull();
  });

  it('treats a missing switch as ON (the column default)', async () => {
    mocks.access.mockResolvedValue({ id: 7, ownerId: 'u1', visibility: 'shared', memoryEnabled: null });
    expect((await resolveAnswerChat({} as Db, { tenantId: 3, userId: null, chatId: 7 }))?.memoryEnabled).toBe(true);
  });
});

describe('chatAnswerOrigin', () => {
  it("reads the chat's own latest real call from the usage ledger", async () => {
    const { db, seen } = usageDb([{ model: 'served/model', promptTokens: 900, completionTokens: 120 }]);
    expect(await chatAnswerOrigin(db, { tenantId: 3, chatId: 7, userId: 'u1' }))
      .toEqual({ model: 'served/model', promptTokens: 900, completionTokens: 120 });
    expect(seen.where).toBeDefined();
  });

  it('is null when no usable row exists — the replay is then an estimate', async () => {
    expect(await chatAnswerOrigin(usageDb([]).db, { tenantId: 3, chatId: 7, userId: null })).toBeNull();
    expect(await chatAnswerOrigin(usageDb([{ model: 'unknown', promptTokens: 1, completionTokens: 1 }]).db, { tenantId: 3, chatId: 7, userId: null })).toBeNull();
  });

  it('never invents a figure when the ledger read fails', async () => {
    expect(await chatAnswerOrigin(usageDb(new Error('neon down')).db, { tenantId: 3, chatId: 7, userId: null })).toBeNull();
  });

  it('bounds the window to the producing turn', () => {
    expect(ANSWER_ORIGIN_WINDOW_MS).toBeGreaterThan(0);
    expect(ANSWER_ORIGIN_WINDOW_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

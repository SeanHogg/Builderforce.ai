/**
 * runChatBinding — a run binds only to a chat its submitter can open. Fakes only the
 * shared chat-access guard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ canAccessChat: vi.fn(async (..._a: unknown[]) => null as unknown) }));
vi.mock('../brain/brainChatGuards', () => ({ canAccessChat: h.canAccessChat }));

import { mayBindRunToChat, unbindableRunChat } from './runChatBinding';

const db = {} as never;
beforeEach(() => vi.clearAllMocks());

describe('mayBindRunToChat', () => {
  it('allows a chat the caller can open, through the shared chat-access guard', async () => {
    h.canAccessChat.mockResolvedValueOnce({ id: 77 });
    expect(await mayBindRunToChat(db, 5, 'user-1', 77)).toBe(true);
    expect(h.canAccessChat).toHaveBeenCalledWith(db, 77, 5, 'user-1');
  });

  it('refuses a chat the caller cannot open, and any chat for a caller with no identity', async () => {
    expect(await mayBindRunToChat(db, 5, 'user-1', 77)).toBe(false);
    expect(await mayBindRunToChat(db, 5, null, 77)).toBe(false);
    expect(await mayBindRunToChat(db, 5, undefined, 77)).toBe(false);
  });
});

describe('unbindableRunChat', () => {
  it('names a payload chat the submitter cannot open', async () => {
    expect(await unbindableRunChat(db, 5, 'user-1', JSON.stringify({ chatId: 77 }))).toBe(77);
  });

  it('passes a payload with no chat, an unparseable one, or a chat the submitter can open', async () => {
    expect(await unbindableRunChat(db, 5, 'user-1', undefined)).toBeNull();
    expect(await unbindableRunChat(db, 5, 'user-1', 'not json')).toBeNull();
    expect(await unbindableRunChat(db, 5, 'user-1', JSON.stringify({ cloudAgentRef: 'a' }))).toBeNull();
    h.canAccessChat.mockResolvedValueOnce({ id: 77 });
    expect(await unbindableRunChat(db, 5, 'user-1', JSON.stringify({ chatId: 77 }))).toBeNull();
    expect(h.canAccessChat).toHaveBeenCalledTimes(1);
  });
});

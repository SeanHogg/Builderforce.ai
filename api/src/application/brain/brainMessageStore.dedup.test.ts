/**
 * A keyed append that deduplicates changes nothing a reader or an unread badge could show: it answers the ORIGINAL
 * row, reports nothing as written, and bumps no cache. Only rows actually inserted do.
 */
import { describe, expect, it, vi } from 'vitest';

const bumps = vi.hoisted(() => ({ messages: vi.fn(async () => undefined), unread: vi.fn(async () => undefined) }));
vi.mock('./chatCacheVersions', () => ({ bumpChatMessages: bumps.messages, bumpUnreadForChatAudience: bumps.unread }));

import { appendRawOutcome } from './brainMessageStore';

const row = (id: number, content: string, eventKey: string | null) => ({ id, role: 'user', content, metadata: null, seq: id, createdAt: new Date(0), eventKey });

/** A drizzle stand-in: `inserted` is what the INSERT ... ON CONFLICT DO NOTHING returned, `existing` what the key read-back finds. */
function fakeDb(inserted: ReturnType<typeof row>[], existing: ReturnType<typeof row>[]) {
  return {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ tenantId: 1, lastSeq: 0 }] }) }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => inserted }) }) }),
    select: () => ({ from: () => ({ where: async () => existing }) }),
  } as never;
}

describe('appendRawOutcome - what was written NOW', () => {
  it('a retry of a message that already committed answers its original row, writes nothing, bumps nothing', async () => {
    bumps.messages.mockClear();
    bumps.unread.mockClear();

    const out = await appendRawOutcome(fakeDb([], [row(5, 'keep going', 'steer:k')]), 9, [{ role: 'user', content: 'keep going', eventKey: 'steer:k' }]);

    expect(out.rows.map((r) => r.id)).toEqual([5]);
    expect(out.written).toEqual([]);
    expect(out.writtenRows).toEqual([]);
    expect(bumps.messages).not.toHaveBeenCalled();
    expect(bumps.unread).not.toHaveBeenCalled();
  });

  it('the first attempt is written and bumps the caches', async () => {
    bumps.messages.mockClear();
    const message = { role: 'user', content: 'keep going', eventKey: 'steer:k' };

    const out = await appendRawOutcome(fakeDb([row(5, 'keep going', 'steer:k')], []), 9, [message]);

    expect(out.written).toEqual([message]);
    expect(out.writtenRows.map((r) => r.id)).toEqual([5]);
    expect(bumps.messages).toHaveBeenCalledTimes(1);
  });

  it('a batch that mixes a committed key with a new message reports only the new one', async () => {
    const fresh = { role: 'user', content: 'and this', eventKey: 'steer:new' };
    const out = await appendRawOutcome(fakeDb([row(6, 'and this', 'steer:new')], [row(5, 'keep going', 'steer:k')]), 9, [
      { role: 'user', content: 'keep going', eventKey: 'steer:k' },
      fresh,
    ]);

    expect(out.rows.map((r) => r.id)).toEqual([5, 6]);
    expect(out.written).toEqual([fresh]);
  });
});

/**
 * `liveChats` — the rule that makes Archive actually archive on the device.
 *
 * The panel's archive path writes `isArchived: true` onto the LOCAL record (never a
 * delete: the transcript of a chat whose messages have not synced yet must survive).
 * That flag is inert unless the surfaces that LIST chats drop the row — and the device
 * record store has no `archived=exclude` query the way the platform list does. These
 * tests pin that filter, because the alternative failure is silent: the menu action
 * succeeds, the row stays, and Archive looks broken.
 */
import { describe, expect, it } from 'vitest';
import { liveChats, type LocalChat } from './records';

function chat(id: number, extra: Partial<LocalChat> = {}): LocalChat {
  return {
    id,
    title: `chat ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    syncKey: `sync-${id}`,
    ...extra,
  };
}

describe('liveChats', () => {
  it('keeps a chat with no archive flag — absent means not archived, like the platform column default', () => {
    const chats = [chat(1), chat(2)];
    expect(liveChats(chats).map((c) => c.id)).toEqual([1, 2]);
  });

  it('drops an archived chat from the list the panel offers', () => {
    const chats = [chat(1), chat(2, { isArchived: true }), chat(3)];
    expect(liveChats(chats).map((c) => c.id)).toEqual([1, 3]);
  });

  it('treats an explicit false as live', () => {
    expect(liveChats([chat(1, { isArchived: false })]).map((c) => c.id)).toEqual([1]);
  });

  it('does NOT delete the record: the archived chat survives the filter, only the list omits it', () => {
    const archived = chat(2, { isArchived: true });
    const chats = [chat(1), archived];
    // The source list is untouched, so reopening the panel still finds the transcript.
    expect(chats).toHaveLength(2);
    expect(chats[1]).toBe(archived);
    expect(chats[1]?.isArchived).toBe(true);
  });

  it('returns a new array, never the caller\'s — the memo must not alias the store\'s array', () => {
    const chats = [chat(1)];
    expect(liveChats(chats)).not.toBe(chats);
  });

  it('is empty for an all-archived list, so the panel does not auto-open an archived chat', () => {
    expect(liveChats([chat(1, { isArchived: true })])).toEqual([]);
  });
});

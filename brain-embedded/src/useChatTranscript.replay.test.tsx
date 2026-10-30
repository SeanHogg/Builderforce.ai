import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { setPendingWordsOwner } from './pendingWords';
import { useChatTranscript } from './useChatTranscript';
import type { BrainPersistenceAdapter } from './config';
import type { BrainMessage } from './types';

/**
 * Words an earlier, dead page load left unsaved are saved when a chat is OPENED - once, bounded, beside the read of
 * the transcript (never in front of it) - and the transcript is read again when the replay saved anything.
 */
const ME = { tenant: 1, user: 'u-transcript' };
const msg = (id: number, content: string): BrainMessage => ({ id, seq: id, role: 'user', content, metadata: null, createdAt: '' } as BrainMessage);

function leave(chat: number, eventKey: string, text: string): void {
  localStorage.setItem(`bf:pendingWords:${ME.tenant}:${ME.user}:${chat}`, JSON.stringify([{ eventKey, text, session: 'an-earlier-load', at: Date.now() - 60_000 }]));
}
const journalSize = (chat: number): number => JSON.parse(localStorage.getItem(`bf:pendingWords:${ME.tenant}:${ME.user}:${chat}`) ?? '[]').length;

function adapter(extra: Partial<BrainPersistenceAdapter> = {}) {
  const getMessages = vi.fn(async () => [msg(1, 'already there')]);
  const sendMessages = vi.fn(async () => [] as BrainMessage[]);
  const persistence = { getMessages, sendMessages, ...extra } as unknown as BrainPersistenceAdapter;
  return { persistence, getMessages, sendMessages };
}

const snapshot = { appended: [] as BrainMessage[], messagesEpoch: 0 };
const mount = (persistence: BrainPersistenceAdapter, chatId: number) =>
  renderHook((p: { chatId: number }) => useChatTranscript(persistence, p.chatId, snapshot, { onLoadStart: vi.fn(), onLoadError: vi.fn() }), { initialProps: { chatId } });

beforeEach(() => {
  localStorage.clear();
  setPendingWordsOwner(ME);
});
afterEach(() => setPendingWordsOwner(null));

describe('useChatTranscript - replaying words an earlier page load left', () => {
  it('shows the transcript at once, in parallel with the replay: a save that never answers does not hold the read', async () => {
    leave(9801, 'steer:a', 'left behind');
    const { persistence, sendMessages } = adapter();
    sendMessages.mockImplementation(() => new Promise<never>(() => undefined));

    const { result } = mount(persistence, 9801);

    await waitFor(() => expect(result.current.messages.map((m) => m.content)).toEqual(['already there']));
    expect(sendMessages).toHaveBeenCalledWith(9801, [{ role: 'user', content: 'left behind', eventKey: 'steer:a' }]);
  });

  it('reads the transcript AGAIN once the replay saved something, so the replayed row is in it', async () => {
    leave(9802, 'steer:b', 'saved on open');
    const { persistence, getMessages, sendMessages } = adapter();
    getMessages.mockResolvedValueOnce([msg(1, 'already there')]).mockResolvedValue([msg(1, 'already there'), msg(2, 'saved on open')]);

    const { result } = mount(persistence, 9802);

    await waitFor(() => expect(result.current.messages.map((m) => m.content)).toEqual(['already there', 'saved on open']));
    expect(sendMessages).toHaveBeenCalledTimes(1);
    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(journalSize(9802)).toBe(0);
  });

  it('a row the server already has is the same row: replayed once, forgotten, nothing doubles', async () => {
    leave(9803, 'steer:c', 'it did land');
    const { persistence, sendMessages } = adapter();
    sendMessages.mockResolvedValue([msg(7, 'it did land')]); // the original, answered again under its key

    mount(persistence, 9803);

    await waitFor(() => expect(journalSize(9803)).toBe(0));
    expect(sendMessages).toHaveBeenCalledTimes(1);
  });

  it('runs ONCE per open: a reload or a push does not replay again, though the words are still there', async () => {
    leave(9804, 'steer:d', 'offline');
    const { persistence, sendMessages } = adapter();
    sendMessages.mockRejectedValue(new Error('offline'));

    const { result } = mount(persistence, 9804);
    await waitFor(() => expect(sendMessages).toHaveBeenCalledTimes(1));
    await act(async () => { result.current.reloadMessages(); });
    await act(async () => { result.current.reloadMessages(); });
    await new Promise((r) => setTimeout(r, 20));

    expect(sendMessages).toHaveBeenCalledTimes(1);
    expect(journalSize(9804)).toBe(1); // left for the next open
  });

  it('opening another chat replays that chat\'s words', async () => {
    leave(9805, 'steer:e', 'in the second chat');
    const { persistence, sendMessages } = adapter();

    const { rerender } = mount(persistence, 9806);
    rerender({ chatId: 9805 });

    await waitFor(() => expect(sendMessages).toHaveBeenCalledWith(9805, [{ role: 'user', content: 'in the second chat', eventKey: 'steer:e' }]));
  });
});

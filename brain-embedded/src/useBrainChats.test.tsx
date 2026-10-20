/**
 * The two rules of #5299 that live on the CLIENT, pinned.
 *
 * Both are silent failures. Nothing throws when Summarize overwrites a title or when
 * Archive routes through the delete that tombstones the row — the chat simply ends up
 * named after a paragraph of generated prose, or quietly vanishes with its unsynced
 * transcript. A test that merely calls `summarize` and awaits it passes against the
 * broken version too, so each case here asserts on the WRITES the adapter received.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BrainProvider, type BrainPersistenceAdapter } from './config';
import { useBrainChats } from './useBrainChats';
import type { BrainChat } from './types';

function chat(id: number, extra: Partial<BrainChat> = {}): BrainChat {
  return { id, title: `Chat ${id}`, projectId: null, ...extra } as BrainChat;
}

/**
 * A persistence stub carrying only what these two paths touch. Anything else the hook
 * reaches for throws, so a NEW call in `summarize`/`archive` surfaces here as a failure
 * rather than silently passing against a permissive `vi.fn()`.
 */
function harness(initial: BrainChat[] = [chat(1), chat(2)]) {
  const updateChat = vi.fn(async (id: number) => chat(id));
  const deleteChat = vi.fn(async () => undefined);
  const summarizeChat = vi.fn(async () => ({ summary: 'A long generated paragraph.' }));
  const archiveChat = vi.fn(async () => undefined);
  const listChats = vi.fn(async () => initial);
  const adapter = { updateChat, deleteChat, summarizeChat, archiveChat, listChats } as unknown as BrainPersistenceAdapter;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <BrainProvider config={{ transport: {} as never, persistence: adapter }}>{children}</BrainProvider>
  );
  const view = renderHook(() => useBrainChats(), { wrapper });
  return { ...view, updateChat, deleteChat, summarizeChat, archiveChat, listChats };
}

describe('useBrainChats — Summarize (#5299)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never writes the summary into the chat title', async () => {
    const { result, updateChat } = harness();
    await act(async () => { await result.current.summarize(1); });

    expect(result.current.error).toBe('');
    // The rule is about the WRITES, not the promise: summarize used to call
    // `updateChat(id, { title: result.summary })`.
    expect(updateChat).not.toHaveBeenCalled();
  });

  it('does not write a title even when it could', async () => {
    const { result, updateChat, summarizeChat } = harness();
    summarizeChat.mockResolvedValue({ summary: '<think>reasoning</think>The chat was about X.' });

    await act(async () => { await result.current.summarize(2); });

    for (const call of updateChat.mock.calls) {
      expect(call[1]).not.toHaveProperty('title');
    }
  });

  it('surfaces the server error instead of writing anything', async () => {
    const { result, updateChat, summarizeChat } = harness();
    summarizeChat.mockResolvedValue({ error: 'no access' });

    await act(async () => { await result.current.summarize(1); });

    expect(result.current.error).toBe('no access');
    expect(updateChat).not.toHaveBeenCalled();
  });
});

describe('useBrainChats — Archive (#5299)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('archives through archiveChat and NEVER through deleteChat', async () => {
    // The local-first adapter's deleteChat tombstones the row, so routing Archive
    // through it is what turned "archive" into a destroy.
    const { result, archiveChat, deleteChat } = harness();

    await act(async () => { await result.current.archive(1); });

    expect(archiveChat).toHaveBeenCalledWith(1);
    expect(deleteChat).not.toHaveBeenCalled();
  });

  it('removes the archived chat from the list it rendered, so the row is not re-offered', async () => {
    const { result } = harness([chat(1), chat(2)]);
    await act(async () => { await result.current.archive(1); });

    expect(result.current.chats.map((c) => c.id)).toEqual([2]);
  });

  it('clears the active chat when the archived chat was the open one', async () => {
    const { result } = harness([chat(1), chat(2)]);
    await act(async () => { result.current.select(1); });
    expect(result.current.activeChatId).toBe(1);

    await act(async () => { await result.current.archive(1); });

    expect(result.current.activeChatId).toBeNull();
  });

  it('leaves a different chat active when archiving some other chat', async () => {
    const { result } = harness([chat(1), chat(2)]);
    await act(async () => { result.current.select(2); });

    await act(async () => { await result.current.archive(1); });

    expect(result.current.activeChatId).toBe(2);
  });

  it('reports a failed archive and keeps the chat listed', async () => {
    const { result, archiveChat } = harness([chat(1)]);
    archiveChat.mockRejectedValue(new Error('offline'));

    await act(async () => { await result.current.archive(1); });

    expect(result.current.error).toBe('offline');
    expect(result.current.chats.map((c) => c.id)).toEqual([1]);
  });
});

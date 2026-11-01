import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useChatTranscript } from './useChatTranscript';
import type { BrainPersistenceAdapter } from './config';
import type { BrainMessage } from './types';

/**
 * A host pushes `subscribeMessages` once per step row of a run. Each push used to restart the
 * whole transcript read; a burst is now ONE read in flight and ONE trailing, never a queue.
 */
const msg = (id: number): BrainMessage => ({ id, seq: id, role: 'assistant', content: `m${id}`, metadata: null, createdAt: '' } as BrainMessage);
const snapshot = { appended: [] as BrainMessage[], messagesEpoch: 0 };

function setup() {
  const reads: Array<(rows: BrainMessage[]) => void> = [];
  const getMessages = vi.fn(() => new Promise<BrainMessage[]>((resolve) => { reads.push(resolve); }));
  let push: (() => void) | undefined;
  const persistence = {
    getMessages,
    subscribeMessages: (_chatId: number, onChanged: () => void) => {
      push = onChanged;
      return () => undefined;
    },
  } as unknown as BrainPersistenceAdapter;
  const hook = renderHook(() => useChatTranscript(persistence, 51, snapshot, { onLoadStart: vi.fn(), onLoadError: vi.fn() }));
  return { hook, getMessages, reads, push: () => act(() => push?.()) };
}

describe('useChatTranscript - coalescing host pushes', () => {
  it('turns a burst of pushes during a read into one trailing read', async () => {
    const { hook, getMessages, reads, push } = setup();
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1));

    for (let index = 0; index < 25; index += 1) push();
    expect(getMessages).toHaveBeenCalledTimes(1);

    await act(async () => { reads[0]!([msg(1)]); });
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2));

    for (let index = 0; index < 25; index += 1) push();
    expect(getMessages).toHaveBeenCalledTimes(2);

    await act(async () => { reads[1]!([msg(1), msg(2)]); });
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(3));
    await act(async () => { reads[2]!([msg(1), msg(2), msg(3)]); });
    await waitFor(() => expect(hook.result.current.messages.map((m) => m.id)).toEqual([1, 2, 3]));
    expect(getMessages).toHaveBeenCalledTimes(3);
  });

  it('reads again at once for a push that arrives with nothing in flight', async () => {
    const { hook, getMessages, reads, push } = setup();
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1));
    await act(async () => { reads[0]!([msg(1)]); });
    await waitFor(() => expect(hook.result.current.messages).toHaveLength(1));

    push();
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2));
    await act(async () => { reads[1]!([msg(1), msg(2)]); });
    await waitFor(() => expect(hook.result.current.messages).toHaveLength(2));
    expect(getMessages).toHaveBeenCalledTimes(2);
  });
});

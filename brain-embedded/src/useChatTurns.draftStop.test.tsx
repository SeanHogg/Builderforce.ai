import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { chatDoorLiveness, useChatTurns } from './useChatTurns';
import { useChatCreation } from './useChatCreation';
import { useBrainConversation } from './useBrainConversation';
import { resetBrainRunStore } from './brainRunStore';
import { waitingFor } from './chatDelivery';
import { resetRunSteering } from './runSteering';
import { streamChatCompletion } from './streamChatCompletion';
import { BrainProvider, type BrainConfig, type BrainPersistenceAdapter } from './config';
import { deferred, texts } from './test/draftHost';

vi.mock('./streamChatCompletion', () => ({ streamChatCompletion: vi.fn() }));

let seq = 0;
const persistence = {
  getMessages: vi.fn(async () => []),
  subscribeMessages: vi.fn(() => () => {}),
  sendMessages: vi.fn(async (_chatId: number, msgs: Array<{ role: string; content: string; metadata?: string }>) =>
    msgs.map((m) => ({ id: ++seq, role: m.role, content: m.content, metadata: m.metadata ?? null, seq, createdAt: '' })),
  ),
  setMessageFeedback: vi.fn(async () => ({ ok: true })),
  markChatRead: vi.fn(async () => ({ lastReadSeq: 0 })),
  requestAgentReply: vi.fn(),
  upload: vi.fn(),
  uploadUrl: (key: string) => `https://x/${key}`,
} as unknown as BrainPersistenceAdapter;
const config: BrainConfig = {
  transport: { baseUrl: 'https://gw.example', getToken: () => null },
  persistence,
  resolveSystemPrompt: () => 'You are Brain.',
};
const wrapper = ({ children }: { children: React.ReactNode }) => <BrainProvider config={config}>{children}</BrainProvider>;
const mockStream = vi.mocked(streamChatCompletion);

/** The REAL stack a host mounts: creation -> conversation -> the turn door, the person staying on the DRAFT view. */
function useDraftConversation(create: () => Promise<number | null>, prepareRun: (id: number) => Promise<Record<string, never>>) {
  const { ensureChatId, drafts } = useChatCreation({ chatId: null, create });
  const conv = useBrainConversation({ chatId: null, toolSpecs: [], runTool: vi.fn(), ensureChatId, prepareRun });
  const turns = useChatTurns<string>({
    ...chatDoorLiveness(conv),
    runKey: null,
    drafts,
    send: (text, ctx) => conv.send(text, { draft: ctx?.draft }),
    stop: conv.stop,
  });
  return { turns };
}

describe('Stop on a draft whose first send has created its chat but is still preparing its run', () => {
  beforeEach(() => {
    seq = 0;
    mockStream.mockReset();
    vi.mocked(persistence.sendMessages).mockClear();
    resetRunSteering();
    resetBrainRunStore();
  });

  it('cancels that run through the conversation\'s own Stop: it never starts, the turns waiting behind it are dropped, nothing is woken', async () => {
    const creation = deferred<number | null>();
    const prepare = deferred<Record<string, never>>();
    const create = vi.fn(() => creation.promise);
    const prepareRun = vi.fn(() => prepare.promise);
    const { result } = renderHook(() => useDraftConversation(create, prepareRun), { wrapper });

    let first!: Promise<boolean>;
    act(() => { first = result.current.turns.submit('A'); }); // the draft's first send begins; the chat is being created
    await waitFor(() => expect(create).toHaveBeenCalled());
    await act(async () => { await result.current.turns.submit('B'); });
    await act(async () => { await result.current.turns.submit('C'); });

    await act(async () => { creation.resolve(91); }); // chat 91 exists; A's run is still being prepared; the draft is still on screen
    await waitFor(() => expect(prepareRun).toHaveBeenCalled());
    expect(waitingFor(91).map((w) => w.text)).toEqual(['B', 'C']);

    act(() => result.current.turns.stop()); // Stop on the DRAFT view

    expect(waitingFor(91)).toEqual([]);
    await act(async () => { prepare.resolve({}); await first; }); // preparation ends: the launch is dropped
    expect(mockStream).not.toHaveBeenCalled();
    expect(vi.mocked(persistence.sendMessages).mock.calls.flatMap(([, msgs]) => msgs).filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['A']);
    expect(texts(91)).toEqual([]);
  });
});

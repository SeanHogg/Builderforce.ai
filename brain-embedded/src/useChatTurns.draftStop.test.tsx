import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { chatDoorLiveness, useChatTurns } from './useChatTurns';
import { useChatCreation } from './useChatCreation';
import { useBrainConversation } from './useBrainConversation';
import { isRunning, resetBrainRunStore } from './brainRunStore';
import { waitingFor } from './chatDelivery';
import { drainRunSteering, resetRunSteering } from './runSteering';
import { isStoppedBeforeStart } from './stoppedTurn';
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
/** The rows saved to a chat. */
const rowsFor = (chat: number) => vi.mocked(persistence.sendMessages).mock.calls.filter(([id]) => id === chat).flatMap(([, msgs]) => msgs);

/**
 * A model stream that answers only when told to and, like the real one, REJECTS when its run is stopped. Every run's signal is
 * kept: a run that was stopped has an aborted signal, so "this chat was not stopped" is asserted on the signal itself.
 */
function streamsUntilStopped(): AbortSignal[] {
  const signals: AbortSignal[] = [];
  mockStream.mockImplementation((opts) => new Promise<never>((_, reject) => {
    if (!opts.signal) return;
    signals.push(opts.signal);
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  return signals;
}

/** The REAL stack a host mounts: creation -> conversation -> the turn door, the person staying on the DRAFT view. */
function useDraftConversation(create: () => Promise<number | null>, prepareRun: (id: number) => Promise<Record<string, never>>, chatId: number | null = null) {
  const { ensureChatId, drafts } = useChatCreation({ chatId, create });
  const conv = useBrainConversation({ chatId, toolSpecs: [], runTool: vi.fn(), ensureChatId, drafts, prepareRun });
  const turns = useChatTurns<string>({
    ...chatDoorLiveness(conv),
    runKey: null,
    drafts,
    send: (text, ctx) => conv.send(text, { draft: ctx?.draft }),
    stop: conv.stop,
  });
  return { turns, drafts, conv };
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

  it("never reaches ANOTHER chat's live run: an earlier draft's chat is running, a second draft is mid-creation - Stop cancels only the second draft's launch", async () => {
    const signals = streamsUntilStopped(); // chat 91's run goes on until it is stopped
    const creation = deferred<number | null>();
    const create = vi.fn().mockResolvedValueOnce(91).mockImplementationOnce(() => creation.promise);
    const prepareRun = vi.fn(async () => ({}) as Record<string, never>);
    const { result } = renderHook(() => useDraftConversation(create, prepareRun), { wrapper });

    act(() => { void result.current.turns.submit('A'); }); // the first draft makes chat 91, and its run starts
    await waitFor(() => expect(isRunning(91)).toBe(true));
    expect(mockStream).toHaveBeenCalledTimes(1);

    act(() => result.current.drafts.leave()); // the person is on a NEW draft
    let second!: Promise<boolean>;
    act(() => { second = result.current.turns.submit('B'); });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2)); // the second draft's chat is being created

    act(() => result.current.turns.stop()); // Stop on the second draft

    expect(isRunning(91)).toBe(true); // the first draft's chat keeps running
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false); // ...because it was never stopped (a stream that ignored its signal would hide it)
    await act(async () => { creation.resolve(92); await second; }); // the second draft's chat now exists: its launch is dropped
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(isRunning(92)).toBe(false);
    expect(isRunning(91)).toBe(true);
    expect(signals[0].aborted).toBe(false);
    const rows = vi.mocked(persistence.sendMessages).mock.calls.filter(([, msgs]) => msgs.some((m) => m.role === 'user')).map(([id, msgs]) => [id, msgs[0].content]);
    expect(rows).toEqual([[91, 'A'], [92, 'B']]);
  });

  it("a Stop on a NEW draft with nothing in it is a no-op: another draft's creation still in flight launches", async () => {
    const signals = streamsUntilStopped();
    const creation = deferred<number | null>();
    const create = vi.fn(() => creation.promise);
    const prepareRun = vi.fn(async () => ({}) as Record<string, never>);
    const { result } = renderHook(() => useDraftConversation(create, prepareRun), { wrapper });

    act(() => { void result.current.turns.submit('D1'); }); // draft 1 sends: its chat is being created
    await waitFor(() => expect(create).toHaveBeenCalled());
    act(() => result.current.drafts.leave()); // the person opened chat 50, then pressed New chat: an empty draft is on screen
    expect(result.current.drafts.current()).toBeNull();

    act(() => result.current.turns.stop()); // Stop on the empty draft

    await act(async () => { creation.resolve(91); });
    await waitFor(() => expect(isRunning(91)).toBe(true)); // D1's launch was not dropped
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);
  });

  it("a Stop on a view with no draft token still drops the turns held on that view: one typed there never starts a chat after the Stop", async () => {
    streamsUntilStopped();
    const creation = deferred<number | null>();
    const create = vi.fn().mockImplementationOnce(() => creation.promise).mockResolvedValue(92);
    const prepareRun = vi.fn(async () => ({}) as Record<string, never>);
    const { result } = renderHook(() => useDraftConversation(create, prepareRun), { wrapper });

    act(() => { void result.current.turns.submit('D1'); }); // draft 1 sends: its chat is being created (the view is busy)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    act(() => result.current.drafts.leave()); // a new empty draft is showing: no token
    await act(async () => { await result.current.turns.submit('X'); }); // typed there: held behind the busy view, untagged
    expect(result.current.turns.queued.count).toBe(1);

    act(() => result.current.turns.stop());
    expect(result.current.turns.queued.count).toBe(0); // dropped with the Stop

    await act(async () => { creation.resolve(91); });
    await waitFor(() => expect(isRunning(91)).toBe(true));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); // the busy view going idle would flush a surviving X
    expect(create).toHaveBeenCalledTimes(1); // X never asked for a chat
    expect(vi.mocked(persistence.sendMessages).mock.calls.flatMap(([, msgs]) => msgs).filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['D1']);
  });

  it("each send under a draft token owns its entry: a Stop while the second send prepares drops THAT launch even though the first send's run has started", async () => {
    const signals = streamsUntilStopped();
    const prepare = deferred<Record<string, never>>();
    const create = vi.fn(async () => 91);
    const prepareRun = vi.fn().mockResolvedValueOnce({}).mockImplementationOnce(() => prepare.promise);
    const { result } = renderHook(() => useDraftConversation(create, prepareRun), { wrapper });

    let token!: number;
    act(() => { token = result.current.drafts.begin(); });
    act(() => { void result.current.conv.send('A', { draft: token }); }); // the first send: chat 91, its run starts
    await waitFor(() => expect(isRunning(91)).toBe(true));
    let second!: Promise<boolean>;
    act(() => { second = result.current.conv.send('B', { draft: token }); }); // a second send under the same token, getting ready
    await waitFor(() => expect(prepareRun).toHaveBeenCalledTimes(2));

    act(() => result.current.conv.stop(token)); // the conversation's Stop on that draft
    await act(async () => { prepare.resolve({}); await second; });

    expect(mockStream).toHaveBeenCalledTimes(1); // the second send's launch was dropped
    // ...and not handed to the live run either: a launch that reaches `startRun` while the first send's run is live joins it
    // (`handTurnToLiveRun`), which leaves the stream count alone - so the inbox and the saved rows are what tell the two apart.
    expect(drainRunSteering(91)).toEqual([]);
    expect(rowsFor(91).some((m) => isStoppedBeforeStart(m))).toBe(true);
    expect(signals[0].aborted).toBe(false); // the conversation's Stop never stops a started run - the door's token-scoped stop does
    expect(isRunning(91)).toBe(true);
  });

  it('a send that names no token still owns a Stop entry: Stop on the draft mid-creation drops its launch', async () => {
    const signals = streamsUntilStopped();
    const creation = deferred<number | null>();
    const create = vi.fn(() => creation.promise);
    const { result } = renderHook(() => useDraftConversation(create, async () => ({}) as Record<string, never>), { wrapper });

    let sent!: Promise<boolean>;
    act(() => { sent = result.current.conv.send('x'); }); // the host passes no token (`conv.send(text)`)
    await waitFor(() => expect(create).toHaveBeenCalled());
    const token = result.current.drafts.current();
    expect(token).not.toBeNull();

    act(() => result.current.conv.stop(token)); // the door's Stop: the draft on screen's token
    await act(async () => { creation.resolve(91); await sent; });

    expect(mockStream).not.toHaveBeenCalled();
    expect(signals).toEqual([]);
    expect(rowsFor(91).some((m) => isStoppedBeforeStart(m))).toBe(true);
  });

  it("a host with no binding: Stop with no token drops its one creation's launch", async () => {
    streamsUntilStopped();
    const creation = deferred<number | null>();
    const { result } = renderHook(() => useBrainConversation({ chatId: null, toolSpecs: [], runTool: vi.fn(), ensureChatId: () => creation.promise }), { wrapper });

    let sent!: Promise<boolean>;
    act(() => { sent = result.current.send('x'); });
    act(() => result.current.stop());
    await act(async () => { creation.resolve(91); await sent; });

    expect(mockStream).not.toHaveBeenCalled();
    expect(rowsFor(91).some((m) => isStoppedBeforeStart(m))).toBe(true);
  });

  it("a Stop during creation is the SEND's: a second send under the token that ends first does not erase the cancel", async () => {
    streamsUntilStopped();
    const creation = deferred<number | null>();
    const prepare = deferred<Record<string, never>>();
    const create = vi.fn(() => creation.promise);
    const prepareRun = vi.fn(() => prepare.promise);
    const { result } = renderHook(() => useDraftConversation(create, prepareRun), { wrapper });

    let token!: number;
    act(() => { token = result.current.drafts.begin(); });
    let first!: Promise<boolean>;
    act(() => { first = result.current.conv.send('A', { draft: token }); });
    await waitFor(() => expect(create).toHaveBeenCalled());

    act(() => result.current.conv.stop(token)); // Stop while the chat is being created
    await act(async () => { creation.resolve(91); });
    await waitFor(() => expect(prepareRun).toHaveBeenCalledTimes(1)); // A is getting ready
    await act(async () => { await result.current.conv.send('stop', { draft: token }); }); // a second send under the token ends first
    await act(async () => { prepare.resolve({}); await first; });

    expect(mockStream).not.toHaveBeenCalled(); // A's launch is still dropped
    expect(rowsFor(91).some((m) => isStoppedBeforeStart(m))).toBe(true);
  });

  it("a Stop on the chat a draft made, now selected, drops the second send that is still preparing - while the first send's run is live", async () => {
    const signals = streamsUntilStopped();
    const prepare = deferred<Record<string, never>>();
    const create = vi.fn(async () => 91);
    const prepareRun = vi.fn().mockResolvedValueOnce({}).mockImplementationOnce(() => prepare.promise);
    const { result, rerender } = renderHook(({ chatId }: { chatId: number | null }) => useDraftConversation(create, prepareRun, chatId), { wrapper, initialProps: { chatId: null as number | null } });

    let token!: number;
    act(() => { token = result.current.drafts.begin(); });
    act(() => { void result.current.conv.send('A', { draft: token }); }); // the first send: chat 91, its run starts
    await waitFor(() => expect(isRunning(91)).toBe(true));
    let second!: Promise<boolean>;
    act(() => { second = result.current.conv.send('B', { draft: token }); }); // a second send, getting ready
    await waitFor(() => expect(prepareRun).toHaveBeenCalledTimes(2));
    rerender({ chatId: 91 }); // the host selected the chat the draft made

    act(() => result.current.conv.stop()); // the chat view's Stop
    await act(async () => { prepare.resolve({}); await second; });

    expect(mockStream).toHaveBeenCalledTimes(1); // A's run only
    expect(signals[0].aborted).toBe(true); // ...which the chat's Stop ended
    expect(drainRunSteering(91)).toEqual([]); // B was not handed to the live run (`handTurnToLiveRun`)
    expect(rowsFor(91).some((m) => isStoppedBeforeStart(m))).toBe(true); // B's launch was dropped before it started
  });
});

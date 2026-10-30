import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useChatTurns } from './useChatTurns';
import { useChatCreation } from './useChatCreation';
import { drainRunSteering, hasRunInterrupt, resetRunSteering } from './runSteering';

const stopRun = vi.hoisted(() => vi.fn());
vi.mock('./brainRunStore', () => ({ stopRun }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface HostPorts {
  /** Creates (and, in a real host, selects) the draft's chat. */
  create: () => Promise<number | null>;
  /** The host's send for one turn: `ensure` is the conversation's `ensureChatId`; `chatNow` reads the chat showing. */
  send: (text: string, ensure: () => Promise<number | null>, chatNow: () => number | null) => Promise<boolean>;
  restore: (turn: string) => void;
}

/** The real creation hook under the real turn door - a host in miniature. The test drives which chat is showing. */
function useDraftHost(ports: HostPorts) {
  const [chatId, setChatId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const chatRef = useRef(chatId);
  chatRef.current = chatId;
  const { ensureChatId, drafts } = useChatCreation({ chatId, create: ports.create });
  const turns = useChatTurns<string>({
    running,
    steerable: false,
    runKey: chatId,
    drafts,
    send: (text) => { setRunning(true); return ports.send(text, ensureChatId, () => chatRef.current); },
    isDirected: () => false,
    restore: ports.restore,
    join: (held) => held.join('\n\n'),
  });
  return { setChatId, setRunning, turns };
}

const sendViaCreation: HostPorts['send'] = async (_text, ensure) => (await ensure()) != null;
const held = (host: { turns: { queued: { items: readonly { value: string }[] } } }) => host.turns.queued.items.map((i) => i.value);

describe('useChatTurns - turns typed while a draft creates its chat belong to THAT creation', () => {
  beforeEach(() => { stopRun.mockClear(); resetRunSteering(); });

  it('genuine: draft send A, B and C typed while it creates - they land in the created chat, in order', async () => {
    const creation = deferred<number | null>();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });
    expect(held(result.current)).toEqual(['B', 'C']);

    await act(async () => { creation.resolve(91); });
    act(() => result.current.setChatId(91));

    expect(drainRunSteering(91).map((m) => m.text)).toEqual(['B', 'C']);
    expect(held(result.current)).toEqual([]);
  });

  it('genuine: the created chat already showing when its id arrives holds them for its run, as a send into it would', async () => {
    const creation = deferred<number | null>();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });

    act(() => result.current.setChatId(91)); // selected first...
    expect(held(result.current)).toEqual([]); // ...the draft's turns are not in the chat's own queue yet
    await act(async () => { creation.resolve(91); }); // ...then its creation answers

    expect(held(result.current)).toEqual(['B', 'C']);
    expect(drainRunSteering(91)).toEqual([]);
  });

  it('delayed creation: the previous chat (77) is clicked while the new draft\'s send is creating - the typed turn goes to the NEW chat, never 77', async () => {
    const creation = deferred<number | null>();
    const restore = vi.fn();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore }));
    act(() => result.current.setChatId(77)); // the previous chat, shown...
    act(() => result.current.setChatId(null)); // ...then New chat
    await act(async () => { void result.current.turns.submit('X'); }); // creates chat 91 (slowly)
    await act(async () => { await result.current.turns.submit('Y'); });

    act(() => result.current.setChatId(77)); // the person clicks 77 before the creation answers
    expect(held(result.current)).toEqual([]); // Y is not in 77's queue
    expect(drainRunSteering(77)).toEqual([]);
    expect(hasRunInterrupt(77)).toBe(false);
    expect(restore).not.toHaveBeenCalled();

    await act(async () => { creation.resolve(91); });

    expect(drainRunSteering(91).map((m) => m.text)).toEqual(['Y']);
    expect(drainRunSteering(77)).toEqual([]);
    expect(hasRunInterrupt(77)).toBe(false);
  });

  it('delayed ensure (the editor\'s limbic fetch): the person leaves before the send gets to create - nothing is created and Y goes back to the box, never to 77', async () => {
    const prep = deferred<void>();
    const create = vi.fn(() => Promise.resolve(91));
    const restore = vi.fn();
    const send: HostPorts['send'] = async (_text, ensure, chatNow) => {
      const startedIn = chatNow();
      await prep.promise;
      if (chatNow() !== startedIn) return false; // another chat is showing: not sent
      return (await ensure()) != null;
    };
    const { result } = renderHook(() => useDraftHost({ create, send, restore }));
    act(() => result.current.setChatId(77));
    act(() => result.current.setChatId(null));
    let sent: Promise<boolean> | undefined;
    await act(async () => { sent = result.current.turns.submit('X'); }); // prep pending
    await act(async () => { await result.current.turns.submit('Y'); });

    act(() => result.current.setChatId(77));
    expect(drainRunSteering(77)).toEqual([]);
    await act(async () => { prep.resolve(); });

    await expect(sent).resolves.toBe(false); // X is the caller's to put back
    expect(create).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('Y');
    expect(drainRunSteering(77)).toEqual([]);
    expect(hasRunInterrupt(77)).toBe(false);
  });

  it('overlapping creations: an abandoned draft\'s creation answering late never receives the next draft\'s turns', async () => {
    const creations = [deferred<number | null>(), deferred<number | null>()];
    let started = 0;
    const { result } = renderHook(() => useDraftHost({ create: () => creations[started++].promise, send: sendViaCreation, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); }); // draft A creates...
    await act(async () => { await result.current.turns.submit('A2'); });

    act(() => result.current.setChatId(5)); // ...the person leaves for chat 5, then starts a NEW draft
    act(() => result.current.setRunning(false));
    act(() => result.current.setChatId(null));
    await act(async () => { void result.current.turns.submit('B'); });
    await act(async () => { await result.current.turns.submit('B2'); });
    expect(held(result.current)).toEqual(['B2']); // A2 is not in draft B's queue

    await act(async () => { creations[0].resolve(9); }); // A's creation answers late
    expect(drainRunSteering(9).map((m) => m.text)).toEqual(['A2']);
    expect(held(result.current)).toEqual(['B2']);

    await act(async () => { creations[1].resolve(12); });
    expect(drainRunSteering(12).map((m) => m.text)).toEqual(['B2']);
    expect(drainRunSteering(9)).toEqual([]);
  });

  it('Stop on a chat switched to leaves the draft\'s held turns alone, and they land in their own chat', async () => {
    const creation = deferred<number | null>();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); });

    act(() => result.current.setChatId(5)); // chat 5 is running; the person stops it
    act(() => result.current.turns.stop());
    expect(stopRun).toHaveBeenCalledWith(5);

    await act(async () => { creation.resolve(91); });
    expect(drainRunSteering(91).map((m) => m.text)).toEqual(['B']);
    expect(drainRunSteering(5)).toEqual([]);
  });

  it('a creation that FAILS gives the turns held for it back to the box, joined in one restore', async () => {
    const creation = deferred<number | null>();
    const restore = vi.fn();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore }));
    await act(async () => { result.current.turns.submit('A').catch(() => undefined); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });

    await act(async () => { creation.reject(new Error('offline')); });

    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('B\n\nC');
    expect(held(result.current)).toEqual([]);
  });
});

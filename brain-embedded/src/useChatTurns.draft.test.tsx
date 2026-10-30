import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { restoreTurn } from './restoreTurn';
import { installRunDriver, type BrainRunDriver } from './runDriver';
import { drainRunSteering, hasRunInterrupt, resetRunSteering } from './runSteering';
import { resetBrainRunStore, stopRun as storeStopRun } from './runStore/runControl';
import { mirrorRun } from './test/mirrorRun';
import { deferred, held, sendViaCreation, texts, useDraftHost, type HostPorts } from './test/draftHost';

const stopRun = vi.hoisted(() => vi.fn());
vi.mock('./brainRunStore', () => ({ stopRun }));

describe('useChatTurns - turns typed while a draft creates its chat belong to THAT creation, and reach its chat\'s run', () => {
  beforeEach(() => { stopRun.mockReset(); resetRunSteering(); resetBrainRunStore(); });
  afterEach(() => installRunDriver(null));

  it('draft send A, B and C typed while it creates - they wait for the created chat\'s run and steer into it, in order, when it goes live', async () => {
    const creation = deferred<number | null>();
    const run = deferred<void>();
    const send: HostPorts['send'] = async (_text, ensure) => { const id = await ensure(); await run.promise; return id != null; };
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });
    expect(held(result.current)).toEqual(['B', 'C']);

    await act(async () => { creation.resolve(91); });
    act(() => result.current.setChatId(91));
    expect(held(result.current)).toEqual(['B', 'C']); // out of the draft's queue, WAITING in chat 91's - visible there until its run is live
    expect(drainRunSteering(91)).toEqual([]); // ...and it is not live yet

    act(() => mirrorRun(91, true)); // A's send saved its row and the run began

    expect(hasRunInterrupt(91)).toBe(true);
    expect(texts(91)).toEqual(['B', 'C']);
    expect(held(result.current)).toEqual([]); // heard by the run: no longer waiting
    await act(async () => { run.resolve(); });
  });

  it('VS Code shape (a run driver installed), the id resolves BEFORE the host commits the chat: B and C still reach chat 91\'s run through the driver, in order', async () => {
    const steer = vi.fn();
    installRunDriver({ start: vi.fn(), stop: vi.fn(), confirm: vi.fn(), clearError: vi.fn(), steer } as unknown as BrainRunDriver);
    const restore = vi.fn();
    const creation = deferred<number | null>();
    const run = deferred<void>();
    const send: HostPorts['send'] = async (_text, ensure) => { const id = await ensure(); await run.promise; return id != null; };
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send, restore }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });

    await act(async () => { creation.resolve(91); }); // the id is known; the host has NOT selected the chat yet
    expect(restore).not.toHaveBeenCalled(); // a driver is installed, and still nothing goes back to the box
    expect(steer).not.toHaveBeenCalled(); // the run is not live yet: wait for it

    act(() => result.current.setChatId(91)); // the host commits the selection...
    expect(steer).not.toHaveBeenCalled();
    act(() => mirrorRun(91, true)); // ...and the host's run mirrors in

    expect(steer).toHaveBeenCalledTimes(1); // ONE call carries both, each turn with its own key
    expect(steer.mock.calls[0]![0]).toBe(91);
    expect(steer.mock.calls[0]![1].map((turn: { text: string }) => turn.text)).toEqual(['B', 'C']);
    expect(new Set(steer.mock.calls[0]![1].map((turn: { eventKey: string }) => turn.eventKey)).size).toBe(2);
    expect(restore).not.toHaveBeenCalled();
    expect(texts(91)).toEqual([]); // the webview's own inbox is read by nobody; the driver was the way
    await act(async () => { run.resolve(); });
  });

  it('the created chat is NOT selected at all when its id arrives (the person is in chat 77): B and C are still delivered to chat 91\'s run', async () => {
    const creation = deferred<number | null>();
    const run = deferred<void>();
    const send: HostPorts['send'] = async (_text, ensure) => { const id = await ensure(); await run.promise; return id != null; };
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });
    act(() => result.current.setChatId(77)); // the person went elsewhere
    await act(async () => { creation.resolve(91); });
    expect(texts(77)).toEqual([]);

    act(() => mirrorRun(91, true));

    expect(texts(91)).toEqual(['B', 'C']);
    expect(texts(77)).toEqual([]);
    expect(hasRunInterrupt(77)).toBe(false);
    await act(async () => { run.resolve(); });
  });

  it('the draft-held turns go FIRST: what is typed into the created chat after it is selected (D) follows them', async () => {
    const creation = deferred<number | null>();
    const run = deferred<void>();
    const send: HostPorts['send'] = async (_text, ensure) => { const id = await ensure(); await run.promise; return id != null; };
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });
    await act(async () => { creation.resolve(91); });
    act(() => result.current.setChatId(91));
    await act(async () => { await result.current.turns.submit('D'); }); // typed into chat 91, whose run is still being made
    expect(held(result.current)).toEqual(['B', 'C', 'D']); // the draft-held turns wait in front of D

    act(() => { mirrorRun(91, true); result.current.setSteerable(true); });

    expect(texts(91)).toEqual(['B', 'C', 'D']);
    await act(async () => { run.resolve(); });
  });

  it('a turn queued for AFTER (queueAfter) in a draft waits for the created chat\'s run to end and is then that chat\'s next turn', async () => {
    const creation = deferred<number | null>();
    const run = deferred<void>();
    const send: HostPorts['send'] = async (_text, ensure) => { const id = await ensure(); await run.promise; return id != null; };
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.queueAfter('for later'); });
    await act(async () => { creation.resolve(78); });
    act(() => result.current.setChatId(78));
    act(() => mirrorRun(78, true));
    expect(texts(78)).toEqual([]); // not direction for this run

    act(() => mirrorRun(78, false)); // the run ended

    expect(texts(78)).toEqual(['for later']);
    await act(async () => { run.resolve(); });
  });

  it('the first send ends without its run ever going live: the held turns are the chat\'s next turn - never left waiting', async () => {
    const creation = deferred<number | null>();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });

    await act(async () => { creation.resolve(91); });

    expect(texts(91)).toEqual(['B', 'C']);
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
    expect(texts(77)).toEqual([]);
    expect(hasRunInterrupt(77)).toBe(false);
    expect(restore).not.toHaveBeenCalled();

    await act(async () => { creation.resolve(91); });

    expect(texts(91)).toEqual(['Y']);
    expect(texts(77)).toEqual([]);
    expect(hasRunInterrupt(77)).toBe(false);
  });

  it('delayed ensure (the editor\'s limbic fetch): the person leaves before the send gets to create - nothing is created and X AND Y come back to the box as ONE joined turn, once', async () => {
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
    expect(texts(77)).toEqual([]);
    await act(async () => { prep.resolve(); });

    await expect(sent).resolves.toBe(true); // X was put back by the door, together with Y: the host's own put-back has nothing to do
    expect(create).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('X\n\nY');
    expect(texts(77)).toEqual([]);
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
    expect(texts(9)).toEqual(['A2']);
    expect(held(result.current)).toEqual(['B2']);

    await act(async () => { creations[1].resolve(12); });
    expect(texts(12)).toEqual(['B2']);
    expect(texts(9)).toEqual([]);
  });

  it('a creation asks for the token its send BEGAN with: a late X (T1) creates its own chat and never takes the one Z (T2) made', async () => {
    const prep = deferred<void>();
    const creations = [deferred<number | null>(), deferred<number | null>()];
    let started = 0;
    const create = vi.fn(() => creations[started++].promise);
    const ensured: Record<string, Promise<number | null>> = {};
    const send: HostPorts['send'] = async (text, ensure) => {
      if (text === 'X') await prep.promise; // X's preparation outlasts everything below
      const pending = ensure();
      ensured[text] = pending;
      return (await pending) != null;
    };
    const { result } = renderHook(() => useDraftHost({ create, send, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('X'); }); // X begins T1; its ensure has not run
    await act(async () => { await result.current.turns.submit('Y'); }); // typed behind X: held for T1
    expect(create).not.toHaveBeenCalled();

    act(() => result.current.setChatId(5)); // the person goes to chat 5...
    act(() => result.current.setRunning(false));
    act(() => result.current.setChatId(null)); // ...then New chat
    await act(async () => { void result.current.turns.submit('Z'); }); // Z begins T2 and creates for it
    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => { prep.resolve(); }); // X's ensure runs LATE
    expect(create).toHaveBeenCalledTimes(2); // its own creation - not Z's joined

    await act(async () => { creations[0].resolve(91); creations[1].resolve(92); });
    await expect(ensured['Z']).resolves.toBe(91);
    await expect(ensured['X']).resolves.toBe(92);
    expect(texts(92)).toEqual(['Y']); // X's follow-up lands in X's chat
    expect(texts(91)).toEqual([]); // ...and Z's chat is unaffected
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
    expect(texts(91)).toEqual(['B']);
    expect(texts(5)).toEqual([]);
  });

  it('Stop on the draft itself clears that draft\'s own held turns (they are that conversation\'s queue)', async () => {
    const creation = deferred<number | null>();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); });
    expect(held(result.current)).toEqual(['B']);

    act(() => result.current.turns.stop());
    expect(held(result.current)).toEqual([]);

    await act(async () => { creation.resolve(91); });
    expect(texts(91)).toEqual([]); // B was dropped with the Stop
  });

  it('a Stop on the created chat drops what still waited for its run: its falling edge wakes nothing', async () => {
    stopRun.mockImplementation(storeStopRun); // the door's Stop reaches the store's Stop seam, which drops what waited
    const creation = deferred<number | null>();
    const run = deferred<void>();
    const send: HostPorts['send'] = async (_text, ensure) => { const id = await ensure(); await run.promise; return id != null; };
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send, restore: vi.fn() }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.queueAfter('for later'); });
    await act(async () => { creation.resolve(91); });
    act(() => result.current.setChatId(91));
    act(() => mirrorRun(91, true));

    act(() => result.current.turns.stop());
    act(() => mirrorRun(91, false));

    expect(texts(91)).toEqual([]);
    await act(async () => { run.resolve(); });
  });
});

describe('useChatTurns - a draft whose creation FAILS gives ONE joined turn back, the first send\'s included', () => {
  beforeEach(() => { stopRun.mockReset(); resetRunSteering(); resetBrainRunStore(); });

  it('A and the turns held for it come back in ONE restore - A first - and the send is reported kept (the host puts nothing back twice)', async () => {
    const creation = deferred<number | null>();
    const restore = vi.fn();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore }));
    let sent: Promise<boolean> | undefined;
    await act(async () => { sent = result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });

    await act(async () => { creation.reject(new Error('offline')); });

    await expect(sent).resolves.toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('A\n\nB\n\nC');
    expect(held(result.current)).toEqual([]);
  });

  it('a creation that answers "nothing created" (null) is the same: one joined restore', async () => {
    const creation = deferred<number | null>();
    const restore = vi.fn();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore }));
    let sent: Promise<boolean> | undefined;
    await act(async () => { sent = result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); });

    await act(async () => { creation.resolve(null); });

    await expect(sent).resolves.toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('A\n\nB');
  });

  it('a failed creation with nothing held restores the send\'s own turn once and reports it kept', async () => {
    const creation = deferred<number | null>();
    const restore = vi.fn();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore }));
    let sent: Promise<boolean> | undefined;
    await act(async () => { sent = result.current.turns.submit('A'); });

    await act(async () => { creation.reject(new Error('offline')); });

    await expect(sent).resolves.toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('A');
  });

  it('through the shared restore, text the person typed into the box meanwhile is NOT lost: the older turns go in front of it', async () => {
    const creation = deferred<number | null>();
    let box = 'typed meanwhile';
    const composer = { draft: () => box, setInput: (next: (current: string) => string) => { box = next(box); }, restoreAttachments: vi.fn(), chooseRecipient: vi.fn() };
    const restore = vi.fn((turn: string) => restoreTurn({ text: turn, recipient: null }, composer));
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); });

    await act(async () => { creation.reject(new Error('offline')); });

    expect(restore).toHaveBeenCalledTimes(1);
    expect(box).toBe('A\n\nB\n\ntyped meanwhile');
  });

  it('and into an empty box the joined turn comes back whole', async () => {
    const creation = deferred<number | null>();
    let box = '';
    const composer = { draft: () => box, setInput: (next: (current: string) => string) => { box = next(box); }, restoreAttachments: vi.fn(), chooseRecipient: vi.fn() };
    const restore = (turn: string) => restoreTurn({ text: turn, recipient: null }, composer);
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: sendViaCreation, restore }));
    await act(async () => { void result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });

    await act(async () => { creation.reject(new Error('offline')); });

    expect(box).toBe('A\n\nB\n\nC');
  });
});

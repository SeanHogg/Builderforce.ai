import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatTurns, type ChatTurnsOptions } from './useChatTurns';
import { useChatCreation } from './useChatCreation';
import { createDraftBinding } from './draftBinding';
import { deliverToChat, forgetChatDelivery, removeWaiting, waitingFor } from './chatDelivery';
import { installRunDriver, type BrainRunDriver } from './runDriver';
import { drainRunSteering, resetRunSteering } from './runSteering';
import { resetBrainRunStore, stopRun as storeStopRun } from './runStore/runControl';
import { mirrorRun } from './test/mirrorRun';
import { deferred, held, texts, useDraftHost, type HostPorts } from './test/draftHost';

const stopRun = vi.hoisted(() => vi.fn());
vi.mock('./brainRunStore', () => ({ stopRun }));

describe('useChatTurns - a draft chat\'s first id is not a chat switch (turns held for the creation reach the created chat\'s run)', () => {
  beforeEach(() => { stopRun.mockReset(); resetRunSteering(); resetBrainRunStore(); });

  it('turns held while the first turn creates the chat are delivered through THAT chat run, in order - not handed off - the moment it goes live', async () => {
    const drafts = createDraftBinding();
    let finishFirst!: (kept: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((resolve) => { finishFirst = resolve; }));
    const props = (runKey: number | null, running: boolean): ChatTurnsOptions<string> => ({ running, steerable: false, runKey, drafts, send });
    const { result, rerender } = renderHook((p: ChatTurnsOptions<string>) => useChatTurns<string>(p), { initialProps: props(null, false) });
    await act(async () => { void result.current.submit('A'); }); // the draft's first send begins (and is minted its token)
    rerender(props(null, true)); // ...and creates the chat
    await act(async () => { await result.current.submit('B'); });
    await act(async () => { await result.current.submit('C'); });
    expect(result.current.queued.count).toBe(2);

    rerender(props(77, true)); act(() => drafts.resolve(drafts.current()!, 77)); // the chat has an id now
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['B', 'C']); // out of the draft's queue, waiting in 77's: visible there
    expect(drainRunSteering(77)).toEqual([]); // ...its run is not live yet

    act(() => mirrorRun(77, true)); // its run goes live
    expect(drainRunSteering(77).map((m) => m.text)).toEqual(['B', 'C']);
    expect(result.current.queued.count).toBe(0);
    await act(async () => { finishFirst(true); });
  });

  it('a turn queued for AFTER the run (queueAfter) in a draft becomes the next turn of the new chat when its run ends', async () => {
    const drafts = createDraftBinding();
    let finishFirst!: (kept: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((resolve) => { finishFirst = resolve; }));
    const props = (runKey: number | null, running: boolean): ChatTurnsOptions<string> => ({ running, steerable: false, runKey, drafts, send });
    const { result, rerender } = renderHook((p: ChatTurnsOptions<string>) => useChatTurns<string>(p), { initialProps: props(null, false) });
    await act(async () => { void result.current.submit('A'); });
    rerender(props(null, true));
    await act(async () => { await result.current.queueAfter('for later'); });

    rerender(props(78, true)); act(() => drafts.resolve(drafts.current()!, 78)); act(() => mirrorRun(78, true));
    expect(drainRunSteering(78)).toEqual([]); // not direction for this run
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['for later']); // still waiting - and visible

    act(() => mirrorRun(78, false)); // the run ended
    expect(drainRunSteering(78).map((m) => m.text)).toEqual(['for later']);
    await act(async () => { finishFirst(true); });
  });
});

describe('useChatTurns - waiting turns are VISIBLE and REMOVABLE; a Stop from anywhere drops them; a creating send that is not kept takes them back', () => {
  beforeEach(() => { stopRun.mockReset(); resetRunSteering(); resetBrainRunStore(); });
  afterEach(() => installRunDriver(null));

  /** A draft whose first send (A) created chat 91 and is held open (`run`), with B and C typed meanwhile - waiting in chat 91. */
  async function waitingInChat91(select = true) {
    const creation = deferred<number | null>();
    const run = deferred<void>();
    const send: HostPorts['send'] = async (_text, ensure) => { const id = await ensure(); await run.promise; return id != null; };
    const hook = renderHook(() => useDraftHost({ create: () => creation.promise, send, restore: vi.fn() }));
    await act(async () => { void hook.result.current.turns.submit('A'); });
    await act(async () => { await hook.result.current.turns.submit('B'); await hook.result.current.turns.submit('C'); });
    await act(async () => { creation.resolve(91); });
    if (select) act(() => hook.result.current.setChatId(91));
    return { ...hook, run };
  }

  it('after the creation answers, the chat\'s queue SHOWS the waiting turns (count included), and removing one means it is never delivered', async () => {
    const { result, run } = await waitingInChat91();
    expect(result.current.turns.queued.count).toBe(2);
    const [b] = result.current.turns.queued.items;

    act(() => result.current.turns.queued.remove(b!.id));
    expect(held(result.current)).toEqual(['C']);

    act(() => mirrorRun(91, true));
    expect(texts(91)).toEqual(['C']);
    await act(async () => { run.resolve(); });
  });

  it('they are shown in THEIR chat only: another chat\'s queue does not carry them', async () => {
    const { result, run } = await waitingInChat91();
    act(() => result.current.setChatId(5));
    expect(held(result.current)).toEqual([]);
    act(() => result.current.setChatId(91));
    expect(held(result.current)).toEqual(['B', 'C']);
    await act(async () => { run.resolve(); });
  });

  it('a Stop from OUTSIDE the door (the conversation\'s own stop, the store\'s) drops them: nothing wakes the chat afterwards', async () => {
    const { result, run } = await waitingInChat91();
    expect(held(result.current)).toEqual(['B', 'C']);

    act(() => storeStopRun(91)); // not the door's Stop
    act(() => mirrorRun(91, true));
    act(() => mirrorRun(91, false));

    expect(held(result.current)).toEqual([]);
    expect(texts(91)).toEqual([]);
    await act(async () => { run.resolve(); });
  });

  it('a Stop on the DRAFT view, after its creation made chat 91 (not selected yet), drops the turns waiting for 91 too: nothing wakes it', async () => {
    stopRun.mockImplementation(storeStopRun); // the door's Stop goes through the store's seam, which ends what waits
    const { result, run } = await waitingInChat91(false);
    expect(waitingFor(91).map((w) => w.text)).toEqual(['B', 'C']);

    act(() => result.current.turns.stop());

    expect(stopRun).toHaveBeenCalledWith(91);
    expect(waitingFor(91)).toEqual([]);
    act(() => mirrorRun(91, true));
    act(() => mirrorRun(91, false));
    expect(texts(91)).toEqual([]);
    await act(async () => { run.resolve(); });
  });

  it('removing every waiting turn leaves nothing behind for the chat (an id nothing holds changes nothing)', async () => {
    const { result, run } = await waitingInChat91();
    for (const item of [...result.current.turns.queued.items]) act(() => result.current.turns.queued.remove(item.id));
    expect(result.current.turns.queued.count).toBe(0);
    act(() => removeWaiting(-12345));
    act(() => mirrorRun(91, true));
    act(() => mirrorRun(91, false));
    expect(texts(91)).toEqual([]);
    await act(async () => { run.resolve(); });
  });

  it('the creating send THROWS after the chat existed and its run was never live: its turn and the waiting ones come back as ONE joined restore, the send first - nothing wakes the chat, the host\'s inbox is untouched', async () => {
    const steer = vi.fn();
    installRunDriver({ start: vi.fn(), stop: vi.fn(), confirm: vi.fn(), clearError: vi.fn(), steer } as unknown as BrainRunDriver);
    const restore = vi.fn();
    const failing: HostPorts['send'] = async (_text, ensure) => { await ensure(); throw new Error('saving the turn failed'); };
    const creation = deferred<number | null>();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: failing, restore }));
    let sent: Promise<boolean> | undefined;
    await act(async () => { sent = result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); await result.current.turns.submit('C'); });

    await act(async () => { creation.resolve(91); });

    await expect(sent).resolves.toBe(true); // reported kept: the host puts nothing back twice
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('A\n\nB\n\nC');
    expect(steer).not.toHaveBeenCalled();
    expect(texts(91)).toEqual([]);
    act(() => result.current.setChatId(91));
    expect(held(result.current)).toEqual([]);
  });

  it('...and when the send returned false rather than threw: the same one joined restore', async () => {
    const restore = vi.fn();
    const notSaved: HostPorts['send'] = async (_text, ensure) => { await ensure(); return false; };
    const creation = deferred<number | null>();
    const { result } = renderHook(() => useDraftHost({ create: () => creation.promise, send: notSaved, restore }));
    let sent: Promise<boolean> | undefined;
    await act(async () => { sent = result.current.turns.submit('A'); });
    await act(async () => { await result.current.turns.submit('B'); });

    await act(async () => { creation.resolve(91); });

    await expect(sent).resolves.toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('A\n\nB');
    expect(texts(91)).toEqual([]);
  });
});

describe('useChatTurns - the Send rule counts the turns waiting in the chat like held ones', () => {
  beforeEach(() => { stopRun.mockReset(); resetRunSteering(); resetBrainRunStore(); });

  it('a message typed while turns WAIT for the chat holds behind them, in order - it does not steer the run past them', async () => {
    mirrorRun(92, true);
    const send = vi.fn();
    const { result } = renderHook(() => useChatTurns<string>({ running: true, steerable: true, runKey: 92, send }));
    expect(result.current.steers({ directed: false })).toBe(true); // nothing is waiting: a message steers

    act(() => deliverToChat(92, [{ text: 'for later', steer: false, turn: 'for later' }])); // held for after the run, in front of the queue
    expect(result.current.steers({ directed: false })).toBe(false);
    await act(async () => { await result.current.submit('next'); });

    expect(drainRunSteering(92)).toEqual([]);
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['for later', 'next']);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('useChatCreation - a draft that already has a chat never makes a second', () => {
  it('a late send naming a token whose creation answered gets THAT chat, even after the person went to another chat; the token is forgotten once no send is pending', async () => {
    const create = vi.fn(() => Promise.resolve(91));
    const { result, rerender } = renderHook(({ chatId }: { chatId: number | null }) => useChatCreation({ chatId, create }), { initialProps: { chatId: null as number | null } });
    const token = result.current.drafts.begin(); // a send from the draft begins and ensures the chat...
    expect(result.current.drafts.begin()).toBe(token); // ...a second send from the same draft is still preparing
    await act(async () => { await result.current.ensureChatId(token); });
    rerender({ chatId: 5 }); // the person went to chat 5

    await expect(result.current.ensureChatId(token)).resolves.toBe(91);
    expect(create).toHaveBeenCalledTimes(1);

    result.current.drafts.settle(token);
    expect(result.current.drafts.outcomeOf(token)).toBe(91); // one send is still pending
    result.current.drafts.settle(token);
    expect(result.current.drafts.outcomeOf(token)).toBeUndefined(); // none: forgotten
  });

  it('a chat that is deleted is not handed to a late send: the token that resolved to it is forgotten, and the send creates anew', async () => {
    const create = vi.fn().mockResolvedValueOnce(91).mockResolvedValueOnce(92);
    const { result } = renderHook(() => useChatCreation({ chatId: null, create }));
    const token = result.current.drafts.begin();
    await act(async () => { await result.current.ensureChatId(token); });
    expect(result.current.drafts.outcomeOf(token)).toBe(91);

    act(() => forgetChatDelivery(91)); // the chat list deleted chat 91

    expect(result.current.drafts.outcomeOf(token)).toBeUndefined();
    await expect(result.current.ensureChatId(token)).resolves.toBe(92);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

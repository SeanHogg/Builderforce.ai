import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { chatDoorLiveness, useChatTurns, type ChatTurns, type ChatTurnsOptions } from './useChatTurns';
import { useChatCreation } from './useChatCreation';
import { createDraftBinding } from './draftBinding';
import { drainRunSteering, hasRunInterrupt, resetRunSteering } from './runSteering';
import { installRunDriver, type BrainRunDriver } from './runDriver';
import { mirrorRun } from './test/mirrorRun';
import { resetBrainRunStore } from './runStore/runControl';

const stopRun = vi.hoisted(() => vi.fn());
vi.mock('./brainRunStore', () => ({ stopRun }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useChatCreation', () => {
  it('creates ONE chat when a second send arrives while the first is still creating', async () => {
    const pending = deferred<number | null>();
    const create = vi.fn(() => pending.promise);
    const { result } = renderHook(() => useChatCreation({ chatId: null, create }));

    const first = result.current.ensureChatId();
    const second = result.current.ensureChatId();
    pending.resolve(42);

    await expect(first).resolves.toBe(42);
    await expect(second).resolves.toBe(42);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never creates for an open chat, and creates again after a failed attempt', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(7);
    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: number | null }) => useChatCreation({ chatId, create }),
      { initialProps: { chatId: null as number | null } },
    );

    await expect(result.current.ensureChatId()).rejects.toThrow('offline');
    await expect(result.current.ensureChatId()).resolves.toBe(7);
    expect(create).toHaveBeenCalledTimes(2);

    rerender({ chatId: 7 });
    await expect(result.current.ensureChatId()).resolves.toBe(7);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('auto-titles through the port, which owns its own failure', async () => {
    const autoTitle = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatCreation({ chatId: 3, create: vi.fn(), autoTitle }));
    await expect(result.current.onFirstUserTurn(3, 'Plan the launch')).resolves.toBeUndefined();
    expect(autoTitle).toHaveBeenCalledWith(3, 'Plan the launch');
  });
});

describe('useChatCreation — original-request capture seam', () => {
  it('captures the first user turn verbatim, beside the auto-title, exactly once per call', async () => {
    const autoTitle = vi.fn().mockResolvedValue(undefined);
    const onCaptureOriginalRequest = vi.fn();
    const { result } = renderHook(() => useChatCreation({
      chatId: 3, create: vi.fn(), autoTitle, onCaptureOriginalRequest,
    }));

    await result.current.onFirstUserTurn(3, 'Rewrite the billing webhook');
    expect(onCaptureOriginalRequest).toHaveBeenCalledTimes(1);
    expect(onCaptureOriginalRequest).toHaveBeenCalledWith(3, 'Rewrite the billing webhook');

    // Same turn, so the two seams cannot drift: both ports see the same (id, text).
    expect(autoTitle).toHaveBeenCalledWith(3, 'Rewrite the billing webhook');
  });

  it('fires once per first turn — a later turn is not re-captured by the hook', async () => {
    const onCaptureOriginalRequest = vi.fn();
    const { result } = renderHook(() => useChatCreation({
      chatId: 3, create: vi.fn(), onCaptureOriginalRequest,
    }));

    // `onFirstUserTurn` is only invoked by the host on the FIRST turn, so the hook
    // fires exactly once however many sends follow.
    await result.current.onFirstUserTurn(3, 'first prompt');
    expect(onCaptureOriginalRequest).toHaveBeenCalledTimes(1);
  });

  it('does not await the capture: a port that never settles cannot hold up the first turn', async () => {
    const autoTitle = vi.fn().mockResolvedValue(undefined);
    // A hung bookkeeping write — the port owns its failure, so the hook never waits on it.
    const onCaptureOriginalRequest = vi.fn(() => new Promise<void>(() => {}));
    const { result } = renderHook(() => useChatCreation({
      chatId: 3, create: vi.fn(), autoTitle, onCaptureOriginalRequest,
    }));

    await expect(result.current.onFirstUserTurn(3, 'first prompt')).resolves.toBeUndefined();
    expect(onCaptureOriginalRequest).toHaveBeenCalledTimes(1);
    // The auto-title on the SAME turn still runs — a stuck capture must not cost the
    // chat its title either.
    expect(autoTitle).toHaveBeenCalledWith(3, 'first prompt');
  });

  it('a rejected autoTitle does not skip the capture (capture is fired first, un-awaited)', async () => {
    const autoTitle = vi.fn().mockRejectedValue(new Error('title endpoint down'));
    const onCaptureOriginalRequest = vi.fn();
    const { result } = renderHook(() => useChatCreation({
      chatId: 3, create: vi.fn(), autoTitle, onCaptureOriginalRequest,
    }));

    await expect(result.current.onFirstUserTurn(3, 'first prompt')).rejects.toThrow('title endpoint down');
    expect(onCaptureOriginalRequest).toHaveBeenCalledWith(3, 'first prompt');
  });

  it('is unaffected when a host passes no capture port (the no-op default)', async () => {
    const autoTitle = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatCreation({ chatId: 3, create: vi.fn(), autoTitle }));
    await expect(result.current.onFirstUserTurn(3, 'first prompt')).resolves.toBeUndefined();
    expect(autoTitle).toHaveBeenCalledTimes(1);
  });

  it('reads the newest capture port through a ref, so a run keeps a stable identity', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ capture }: { capture: (id: number, text: string) => void }) => useChatCreation({
        chatId: 3, create: vi.fn(), onCaptureOriginalRequest: capture,
      }),
      { initialProps: { capture: first } },
    );
    const onFirstUserTurn = result.current.onFirstUserTurn;

    rerender({ capture: second });
    await onFirstUserTurn(3, 'first prompt');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(3, 'first prompt');
  });
});

describe('useChatTurns', () => {
  beforeEach(() => stopRun.mockClear());

  function mount(initial: ChatTurnsOptions<string>) {
    return renderHook((props: ChatTurnsOptions<string>) => useChatTurns(props), { initialProps: initial });
  }

  it('sends straight away when idle and reports a send that was not kept', async () => {
    const send = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { result } = mount({ running: false, runKey: 1, send });

    await expect(result.current.submit('hello')).resolves.toBe(true);
    await expect(result.current.submit('again')).resolves.toBe(false);
    expect(send).toHaveBeenNthCalledWith(1, 'hello');
    expect(send).toHaveBeenNthCalledWith(2, 'again');
  });

  // PRD 35 E10 (the one sanctioned flip): a mid-run message used to be HELD by default; it now
  // steers the run, and holding it for after is the explicit `queueAfter`.
  it('queues (explicitly) while a run is in flight and flushes on its falling edge', async () => {
    const send = vi.fn();
    const { result, rerender } = mount({ running: true, runKey: 1, send });

    await act(async () => { await result.current.queueAfter('next step'); });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.queued.count).toBe(1);

    rerender({ running: false, runKey: 1, send });
    expect(send).toHaveBeenCalledWith('next step');
    expect(result.current.queued.count).toBe(0);
  });

  it('stop clears the queue and stops the run on its key', async () => {
    const send = vi.fn();
    const { result } = mount({ running: true, runKey: 'canvas:9', send });

    await act(async () => { await result.current.submit('one'); await result.current.submit('two'); });
    expect(result.current.queued.count).toBe(2);

    act(() => result.current.stop());
    expect(result.current.queued.count).toBe(0);
    expect(stopRun).toHaveBeenCalledWith('canvas:9');
  });

  it('uses the stop port instead of the store when one is given', () => {
    const stop = vi.fn();
    const { result } = mount({ running: true, runKey: 1, send: vi.fn(), stop });
    act(() => result.current.stop());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stopRun).not.toHaveBeenCalled();
  });

  it('routes a turn through the steer port before the queue, falling through when declined', async () => {
    const send = vi.fn();
    const steer = vi.fn((text: string) => text.startsWith('@child'));
    const { result } = mount({ running: true, runKey: 1, send, steer });

    await act(async () => { await result.current.submit('@child look at this'); });
    expect(steer).toHaveBeenCalledWith('@child look at this');
    expect(result.current.queued.count).toBe(0);

    await act(async () => { await result.current.submit('for the chat'); });
    expect(result.current.queued.count).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a blank turn without sending', async () => {
    const send = vi.fn();
    const { result } = mount({ running: false, runKey: 1, send });
    await expect(result.current.submit('   ')).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('useChatTurns — a typed stop', () => {
  beforeEach(() => stopRun.mockClear());
  type Turn = { text: string; to: string | null };
  const mountTurns = (initial: ChatTurnsOptions<Turn>) =>
    renderHook((props: ChatTurnsOptions<Turn>) => useChatTurns(props), { initialProps: initial });
  const base = (send: (t: Turn) => void, extra: Partial<ChatTurnsOptions<Turn>> = {}): ChatTurnsOptions<Turn> => ({
    running: true, runKey: 4, send, textOf: (t) => t.text, isDirected: (t) => t.to != null, ...extra,
  });

  it('mid-run, is the Stop: the run stops, what was held is dropped, and nothing waits behind it', async () => {
    const send = vi.fn();
    const { result, rerender } = mountTurns(base(send));
    await act(async () => { await result.current.submit({ text: 'next step', to: null }); });
    await act(async () => { await result.current.submit({ text: 'Stop the run', to: null }); });
    expect(stopRun).toHaveBeenCalledWith(4);
    expect(result.current.queued.count).toBe(0);
    // Typed while the stopped run unwinds: held, and sent on its falling edge.
    await act(async () => { await result.current.submit({ text: 'do Y instead', to: null }); });
    rerender(base(send, { running: false }));
    expect(send).toHaveBeenCalledWith({ text: 'do Y instead', to: null });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('addressed to a participant, is a message — the run is not stopped', async () => {
    const send = vi.fn();
    const { result } = mountTurns(base(send));
    await act(async () => { await result.current.submit({ text: 'stop', to: 'agent:ada' }); });
    expect(stopRun).not.toHaveBeenCalled();
    expect(result.current.queued.count).toBe(1);
  });

  it("routed by the host (the editor's run hears it), still drops what is held", async () => {
    const send = vi.fn();
    const steer = vi.fn((t: Turn) => t.text === 'Stop the run');
    const { result } = mountTurns(base(send, { steer }));
    await act(async () => { await result.current.submit({ text: 'queued for after', to: null }); });
    await act(async () => { await result.current.submit({ text: 'Stop the run', to: null }); });
    expect(steer).toHaveBeenCalledWith({ text: 'Stop the run', to: null });
    expect(result.current.queued.count).toBe(0);
  });

  it('idle, is sent (kept as the answer) — the conversation starts no run for it', async () => {
    const send = vi.fn();
    const { result } = mountTurns(base(send, { running: false }));
    await act(async () => { await result.current.submit({ text: 'Stop the run', to: null }); });
    expect(send).toHaveBeenCalledWith({ text: 'Stop the run', to: null });
    expect(stopRun).not.toHaveBeenCalled();
  });
});

describe('chatDoorLiveness', () => {
  it('takes both flags from the one store state: a saving send HOLDS, only a live run is STEERED', () => {
    // Nothing in flight.
    expect(chatDoorLiveness({ sending: false, runLive: false })).toEqual({ running: false, steerable: false });
    // A send saving its row (no run yet): turns typed now are held in order.
    expect(chatDoorLiveness({ sending: true, runLive: false })).toEqual({ running: true, steerable: false });
    // A run executing, or being made for a continuation (the claim): steered.
    expect(chatDoorLiveness({ sending: true, runLive: true })).toEqual({ running: true, steerable: true });
    // The editor's own pre-send work counts as in flight but never as a live run.
    expect(chatDoorLiveness({ sending: false, runLive: false }, true)).toEqual({ running: true, steerable: false });
  });
});

describe('useChatTurns — a mid-run message steers by default (PRD 35 E10)', () => {
  beforeEach(() => { stopRun.mockClear(); resetRunSteering(); });

  function mount(initial: ChatTurnsOptions<string>) {
    return renderHook((props: ChatTurnsOptions<string>) => useChatTurns(props), { initialProps: initial });
  }

  it('posts the message to the run, interrupting the step in flight - nothing is held, nothing is sent', async () => {
    const send = vi.fn();
    const { result } = mount({ running: true, runKey: 12, send });

    await act(async () => { await expect(result.current.submit('write the update now')).resolves.toBe(true); });

    expect(send).not.toHaveBeenCalled();
    expect(result.current.queued.count).toBe(0);
    expect(hasRunInterrupt(12)).toBe(true);
    const [steer] = drainRunSteering(12);
    expect(steer).toMatchObject({ text: 'write the update now', fromPerson: true, persist: true });
  });

  it('carries a non-string turn attachments so a mid-run image is not dropped', async () => {
    type Turn = { text: string; attachments: Array<{ key: string; name: string; type: string; imageUrl: string }> };
    const send = vi.fn();
    const { result } = renderHook(() => useChatTurns<Turn>({
      running: true, runKey: 13, send, textOf: (t) => t.text, attachmentsOf: (t) => t.attachments,
    }));
    const attachments = [{ key: 'a', name: 'shot.png', type: 'image/png', imageUrl: 'data:image/png;base64,AAA' }];

    await act(async () => { await result.current.submit({ text: 'what is in this?', attachments }); });

    expect(drainRunSteering(13)[0]?.attachments?.[0]?.imageUrl).toBe('data:image/png;base64,AAA');
  });

  it('holds instead for a run that cannot be steered here (a canvas key), or one being stopped', async () => {
    const send = vi.fn();
    const canvas = mount({ running: true, runKey: 'canvas:3', send });
    await act(async () => { await canvas.result.current.submit('later'); });
    expect(canvas.result.current.queued.count).toBe(1);

    const stopped = mount({ running: true, runKey: 14, send });
    act(() => stopped.result.current.stop());
    await act(async () => { await stopped.result.current.submit('after the stop'); });
    expect(stopped.result.current.queued.count).toBe(1);
    expect(hasRunInterrupt(14)).toBe(false);
  });

  it('steers a turn of any shape - steered words need only text and files - and words Send the same way (M1)', async () => {
    type Turn = { text: string; to: string | null };
    const { result } = renderHook(() => useChatTurns<Turn>({ running: true, runKey: 15, send: vi.fn(), textOf: (t) => t.text }));
    expect(result.current.steers({ directed: false })).toBe(true);
    await act(async () => { await result.current.submit({ text: 'now', to: null }); });
    expect(result.current.queued.count).toBe(0);
    expect(hasRunInterrupt(15)).toBe(true);
  });

  it('a host steer port asks the door\'s own predicate, and the Send label agrees with it (M1)', async () => {
    const verdicts: boolean[] = [];
    const door: { current?: ChatTurns<string> } = {};
    const steer = vi.fn((_turn: string) => { verdicts.push(door.current!.steers({ directed: false })); return false; });
    const { result } = renderHook(() => (door.current = useChatTurns<string>({ running: true, runKey: 17, send: vi.fn(), steer })));

    expect(result.current.steers({ directed: false })).toBe(true);
    await act(async () => { await result.current.submit('first'); });
    // The port declined, so the turn is held - and the next one waits behind it: the verdict
    // flips with the label, from one predicate.
    await act(async () => { await result.current.queueAfter('held'); });
    expect(result.current.steers({ directed: false })).toBe(false);
    await act(async () => { await result.current.submit('third'); });
    expect(verdicts).toEqual([true, false]);
  });

  it('holds - never steers - while the run is not live yet: the editor\'s limbic fetch window (MUST-FIX 1)', async () => {
    const send = vi.fn();
    // In flight (a send getting ready) but with no run to speak to: `steerable` is the run's own state.
    const { result, rerender } = renderHook((props: ChatTurnsOptions<string>) => useChatTurns(props), {
      initialProps: { running: true, steerable: false, runKey: 18, send } as ChatTurnsOptions<string>,
    });
    expect(result.current.steers({ directed: false })).toBe(false);

    await act(async () => { await result.current.submit('second turn'); });
    expect(hasRunInterrupt(18)).toBe(false);
    expect(drainRunSteering(18)).toEqual([]);
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['second turn']);

    // The run goes live: the turn held ONLY because it was not yet is a follow-up to it - steered in at once.
    rerender({ running: true, steerable: true, runKey: 18, send });
    expect(hasRunInterrupt(18)).toBe(true);
    expect(drainRunSteering(18)).toMatchObject([{ text: 'second turn', fromPerson: true, persist: true }]);
    expect(result.current.queued.count).toBe(0);
    expect(result.current.steers({ directed: false })).toBe(true);
    // ...so nothing is left to send on the falling edge.
    rerender({ running: false, steerable: false, runKey: 18, send });
    expect(send).not.toHaveBeenCalled();
  });

  it('a turn addressed to a participant, not kept after a chat switch, goes back to the COMPOSER - never to a queue or a run (BLOCKER C)', async () => {
    type Turn = { text: string; to: string | null };
    let settle!: (kept: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const restore = vi.fn();
    const props = (running: boolean, runKey: number): ChatTurnsOptions<Turn> =>
      ({ running, runKey, send, restore, textOf: (t) => t.text, isDirected: (t) => t.to != null });
    const { result, rerender } = renderHook((p: ChatTurnsOptions<Turn>) => useChatTurns<Turn>(p), { initialProps: props(true, 19) });
    await act(async () => { await result.current.queueAfter({ text: '@dev look', to: 'dev' }); });
    await act(async () => { rerender(props(false, 19)); });
    expect(send).toHaveBeenCalledTimes(1);
    // The person switched chats while it was being sent, and the send was not kept.
    await act(async () => { rerender(props(false, 20)); });
    await act(async () => { settle(false); });

    expect(restore).toHaveBeenCalledWith({ text: '@dev look', to: 'dev' });
    expect(drainRunSteering(19)).toEqual([]);
    expect(drainRunSteering(20)).toEqual([]);
    // Chat 20's queue is untouched: nothing of chat 19's was posted into it.
    expect(result.current.queued.items).toEqual([]);
  });

  it('a send that throws synchronously is a send not kept: the turn is put back, never lost', async () => {
    const send = vi.fn(() => { throw new Error('bridge closed'); });
    const { result, rerender } = mount({ running: true, runKey: 59, send });
    await act(async () => { await result.current.queueAfter('keep me'); });

    await act(async () => { rerender({ running: false, runKey: 59, send }); });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['keep me']);
  });

  it('does not jump ahead of turns already held: it waits behind them', async () => {
    const send = vi.fn();
    const { result } = mount({ running: true, runKey: 16, send });
    await act(async () => { await result.current.queueAfter('first, for after'); });
    await act(async () => { await result.current.submit('then this'); });
    expect(result.current.queued.count).toBe(2);
    expect(hasRunInterrupt(16)).toBe(false);
  });
});

describe('useChatTurns — direction the run never drained belongs to the run store (D)', () => {
  beforeEach(() => { stopRun.mockClear(); resetRunSteering(); });

  function mount(initial: ChatTurnsOptions<string>) {
    return renderHook((props: ChatTurnsOptions<string>) => useChatTurns(props), { initialProps: initial });
  }

  it("never drains the run's inbox when the run completes - the run store (continueOnSettle) is its one owner", async () => {
    const send = vi.fn();
    const { result, rerender } = mount({ running: true, runKey: 20, send });

    await act(async () => { await result.current.submit('one more thing'); });
    await act(async () => { await result.current.submit('and this'); });

    rerender({ running: false, runKey: 20, send });
    expect(send).not.toHaveBeenCalled();
    expect(drainRunSteering(20).map((m) => m.text)).toEqual(['one more thing', 'and this']);
  });

  it('flushes only the turns it holds itself, one per completed run, leaving the inbox alone', async () => {
    const send = vi.fn();
    const { result, rerender } = mount({ running: true, runKey: 21, send });
    await act(async () => { await result.current.submit('steered first'); });
    await act(async () => { await result.current.queueAfter('held after'); });

    rerender({ running: false, runKey: 21, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('held after');
    expect(drainRunSteering(21).map((m) => m.text)).toEqual(['steered first']);
  });

  it('a steer typed before a Stop does not appear in the next run', async () => {
    const send = vi.fn();
    const { result, rerender } = mount({ running: true, runKey: 22, send });

    await act(async () => { await result.current.submit('typed before the stop'); });
    act(() => result.current.stop());
    // The inbox (and the device's journal) is dropped by the STORE's Stop - every entry point to Stop clears it, so this
    // hook only delegates (`runStore/continueStop.test.ts` holds the drain itself; the store is mocked here).
    expect(stopRun).toHaveBeenCalledWith(22);

    rerender({ running: false, runKey: 22, send });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('useChatTurns - what the door will not steer, and what it will not lose', () => {
  beforeEach(() => { stopRun.mockClear(); resetRunSteering(); });

  type Turn = { text: string; attachments: Array<{ key: string; name: string; type: string; imageUrl?: string }> };
  const mountTurns = (send: ChatTurnsOptions<Turn>['send'], runKey: ChatTurnsOptions<Turn>['runKey'] = 40, running = true) =>
    renderHook((props: ChatTurnsOptions<Turn>) => useChatTurns<Turn>(props), {
      initialProps: {
        running, runKey, send, textOf: (t) => t.text, attachmentsOf: (t) => t.attachments,
      } as ChatTurnsOptions<Turn>,
    });

  it('steers a turn whose files are all pictures, but HOLDS one with a file a steer would drop', async () => {
    const picture = { key: 'p', name: 'shot.png', type: 'image/png', imageUrl: 'data:image/png;base64,AAA' };
    const notes = { key: 'n', name: 'notes.txt', type: 'text/plain' };
    const { result } = mountTurns(vi.fn(), 41);

    await act(async () => { await result.current.submit({ text: 'look at this', attachments: [picture] }); });
    expect(hasRunInterrupt(41)).toBe(true);
    expect(result.current.queued.count).toBe(0);

    await act(async () => { await result.current.submit({ text: 'and read this', attachments: [notes] }); });
    expect(result.current.queued.count).toBe(1);
    expect(result.current.queued.items[0]?.value.attachments).toEqual([notes]);
  });

  it('puts a flushed turn the host did not keep back at the front of the queue', async () => {
    const send = vi.fn().mockResolvedValue(false);
    const { result, rerender } = mountTurns(send, 42);
    await act(async () => { await result.current.queueAfter({ text: 'hold me', attachments: [] }); });

    await act(async () => { rerender({ running: false, runKey: 42, send, textOf: (t) => t.text }); });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.queued.items.map((i) => i.value.text)).toEqual(['hold me']);
  });

  it('refuses to hold a blank turn for after', async () => {
    const send = vi.fn();
    const { result } = mountTurns(send, 43);
    await act(async () => { await expect(result.current.queueAfter({ text: '   ', attachments: [] })).resolves.toBe(false); });
    expect(result.current.queued.count).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('never sends the previous chat\'s unread steer into the chat now showing - it stays in its own inbox', async () => {
    const send = vi.fn();
    const { result, rerender } = renderHook((props: ChatTurnsOptions<string>) => useChatTurns(props), {
      initialProps: { running: true, runKey: 44, send } as ChatTurnsOptions<string>,
    });
    await act(async () => { await result.current.submit('for the first chat'); });

    rerender({ running: false, runKey: 45, send });

    expect(send).not.toHaveBeenCalled();
    expect(drainRunSteering(44).map((m) => m.text)).toEqual(['for the first chat']);
  });
});

describe('useChatTurns - a flush that is not kept, a Stop, and the line of waiting turns', () => {
  beforeEach(() => { stopRun.mockClear(); resetRunSteering(); });

  function mount(initial: ChatTurnsOptions<string>) {
    return renderHook((props: ChatTurnsOptions<string>) => useChatTurns(props), { initialProps: initial });
  }

  it('hands a failed flush back to ITS chat when the person has switched away - never into the chat now showing', async () => {
    let settle!: (kept: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const { result, rerender } = mount({ running: true, runKey: 50, send });
    await act(async () => { await result.current.queueAfter('mine'); });

    rerender({ running: false, runKey: 50, send });
    expect(send).toHaveBeenCalledWith('mine');
    rerender({ running: false, runKey: 51, send });
    await act(async () => { settle(false); });

    expect(result.current.queued.count).toBe(0);
    expect(drainRunSteering(50).map((m) => m.text)).toEqual(['mine']);
  });

  it('does not put a turn back when a Stop landed while its send was in flight', async () => {
    let settle!: (kept: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const { result, rerender } = mount({ running: true, runKey: 53, send });
    await act(async () => { await result.current.queueAfter('in flight'); });
    rerender({ running: false, runKey: 53, send });

    act(() => result.current.stop());
    await act(async () => { settle(false); });

    expect(result.current.queued.count).toBe(0);
  });

  it('an idle send goes BEHIND the turns waiting (the oldest is sent now), and a put-back turn does not force-hold the next run', async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result, rerender } = mount({ running: true, runKey: 54, send });
    await act(async () => { await result.current.queueAfter('A'); });
    await act(async () => { await result.current.queueAfter('B'); });

    // The run ends: the oldest is sent, is not kept, and goes back to the front.
    await act(async () => { rerender({ running: false, runKey: 54, send }); });
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['A', 'B']);

    // Idle, the person types C: A (the oldest) goes first; C waits behind B.
    await act(async () => { await result.current.submit('C'); });
    expect(send).toHaveBeenLastCalledWith('A');
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['B', 'C']);

    // The next run starts with those two carried in: a message typed during it still steers.
    await act(async () => { rerender({ running: true, runKey: 54, send }); });
    await act(async () => { await result.current.submit('mid-run'); });
    expect(hasRunInterrupt(54)).toBe(true);
    expect(result.current.queued.count).toBe(2);
  });

  it('one path sends: a turn typed while a queued one is being sent follows it, and the edge does not double-send', async () => {
    let settle!: (kept: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const { result, rerender } = mount({ running: true, runKey: 58, send });
    await act(async () => { await result.current.queueAfter('A'); });
    await act(async () => { await result.current.queueAfter('B'); });
    await act(async () => { rerender({ running: false, runKey: 58, send }); });
    expect(send.mock.calls.map((c) => c[0])).toEqual(['A']);

    // Idle, A still being sent: C waits behind B, nothing else is sent beside A.
    await act(async () => { await result.current.submit('C'); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['B', 'C']);

    // A was kept and started its run: B and C wait for that run's falling edge.
    await act(async () => { settle(true); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['B', 'C']);
  });

  it('an idle turn that starts no run (a typed stop) does not strand the turns held behind it', async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result, rerender } = mount({ running: true, runKey: 56, send });
    await act(async () => { await result.current.queueAfter('Stop the run'); });
    await act(async () => { await result.current.queueAfter('then do this'); });

    // The run ends: the stop is sent, not kept, and goes back; the person then types a third.
    await act(async () => { rerender({ running: false, runKey: 56, send }); });
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['Stop the run', 'then do this']);
    send.mockClear();
    await act(async () => { await result.current.submit('third'); });

    // The stop starts no run, so no falling edge would send the rest: it chains on at once.
    expect(send.mock.calls.map((c) => c[0])).toEqual(['Stop the run', 'then do this']);
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['third']);
  });

  it('counts held-this-run by turn id: removing a carried turn does not make a new one look carried', async () => {
    const send = vi.fn().mockResolvedValue(false);
    const { result, rerender } = mount({ running: true, runKey: 57, send });
    await act(async () => { await result.current.queueAfter('A'); });
    await act(async () => { await result.current.queueAfter('B'); });
    await act(async () => { rerender({ running: false, runKey: 57, send }); });
    // A was put back (not kept); B is still waiting. The next run carries both.
    await act(async () => { rerender({ running: true, runKey: 57, send }); });
    const [first] = result.current.queued.items;
    act(() => result.current.queued.remove(first!.id));
    // Nothing was held THIS run, however many were carried in: a message typed now still steers.
    expect(result.current.steers({ directed: false })).toBe(true);
    await act(async () => { await result.current.queueAfter('held this run'); });
    expect(result.current.steers({ directed: false })).toBe(false);
  });

  it('words Send from the same predicate: a run being stopped, and a turn behind held ones, will not steer', async () => {
    const { result } = mount({ running: true, runKey: 55, send: vi.fn() });
    expect(result.current.steers({ directed: false })).toBe(true);
    expect(result.current.steers({ directed: true })).toBe(false);
    expect(result.current.steers({ directed: false, attachments: [{}] })).toBe(false);

    await act(async () => { await result.current.queueAfter('held'); });
    expect(result.current.steers({ directed: false })).toBe(false);

    act(() => result.current.stop());
    expect(result.current.steers({ directed: false })).toBe(false);
  });
});

describe('useChatTurns - where a turn goes when it is not kept after a chat switch (round 8)', () => {
  beforeEach(() => { stopRun.mockClear(); resetRunSteering(); });

  it('with the run executing elsewhere (a run driver), ANY such turn returns to the composer - never the webview\'s inbox', async () => {
    installRunDriver({} as BrainRunDriver);
    try {
      let settle!: (kept: boolean) => void;
      const send = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
      const restore = vi.fn();
      const props = (running: boolean, runKey: number): ChatTurnsOptions<string> => ({ running, runKey, send, isDirected: () => false, restore });
      const { result, rerender } = renderHook((p: ChatTurnsOptions<string>) => useChatTurns<string>(p), { initialProps: props(true, 70) });
      await act(async () => { await result.current.queueAfter('plain turn'); });
      await act(async () => { rerender(props(false, 70)); });
      await act(async () => { rerender(props(false, 71)); });
      await act(async () => { settle(false); });

      expect(restore).toHaveBeenCalledWith('plain turn');
      expect(drainRunSteering(70)).toEqual([]);
      expect(result.current.queued.items).toEqual([]);
    } finally {
      installRunDriver(null);
    }
  });

  it('turns held only because no run was live are steered in ORDER when it goes live, before any later message; queue-after turns stay queued', async () => {
    const send = vi.fn();
    const props = (steerable: boolean): ChatTurnsOptions<string> => ({ running: true, steerable, runKey: 72, send });
    const { result, rerender } = renderHook((p: ChatTurnsOptions<string>) => useChatTurns<string>(p), { initialProps: props(false) });
    await act(async () => { await result.current.submit('M1'); });
    await act(async () => { await result.current.submit('M2'); });
    await act(async () => { await result.current.queueAfter('for the next turn'); });
    expect(result.current.queued.count).toBe(3);

    rerender(props(true)); // the run goes live: M1, M2 are follow-ups to it
    expect(result.current.steers({ directed: false })).toBe(true);
    await act(async () => { await result.current.submit('M3'); });

    expect(hasRunInterrupt(72)).toBe(true);
    expect(drainRunSteering(72).map((m) => m.text)).toEqual(['M1', 'M2', 'M3']);
    expect(result.current.queued.items.map((i) => i.value)).toEqual(['for the next turn']);
  });

  it('flushing is per chat: a turn typed in idle chat B is sent while chat A\'s queued turn still awaits its run', async () => {
    let settleA!: (kept: boolean) => void;
    const send = vi.fn((turn: string) => (turn === 'for A' ? new Promise<boolean>((resolve) => { settleA = resolve; }) : Promise.resolve(true)));
    const props = (running: boolean, runKey: number): ChatTurnsOptions<string> => ({ running, runKey, send });
    const { result, rerender } = renderHook((p: ChatTurnsOptions<string>) => useChatTurns<string>(p), { initialProps: props(true, 80) });
    await act(async () => { await result.current.queueAfter('for A'); });
    await act(async () => { rerender(props(false, 80)); }); // A's run ended: its queued turn is being sent (awaiting its run)
    expect(send).toHaveBeenCalledWith('for A');

    await act(async () => { rerender(props(false, 81)); }); // the person is now in idle chat B
    await act(async () => { await expect(result.current.submit('for B')).resolves.toBe(true); });

    expect(send).toHaveBeenCalledWith('for B'); // sent now - not lined up behind A's
    expect(result.current.queued.count).toBe(0);
    await act(async () => { settleA(true); });
  });
});

describe('useChatTurns - round 10: a held-before-live turn belongs to ITS chat; one it cannot steer blocks the line', () => {
  beforeEach(() => { stopRun.mockClear(); resetRunSteering(); });

  it('never steers chat A\'s held turn into chat B\'s run after a switch', async () => {
    const send = vi.fn();
    const props = (runKey: number, steerable: boolean): ChatTurnsOptions<string> => ({ running: true, steerable, runKey, send });
    const { result, rerender } = renderHook((p: ChatTurnsOptions<string>) => useChatTurns<string>(p), { initialProps: props(90, false) });
    await act(async () => { await result.current.submit('for chat A'); });
    expect(result.current.queued.count).toBe(1);

    rerender(props(91, true)); // switched to chat B, whose run is live

    expect(hasRunInterrupt(91)).toBe(false);
    expect(drainRunSteering(91)).toEqual([]);
    // ...and chat A's words went to chat A: its inbox, to be saved (under their key) and read by A's next run.
    expect(result.current.queued.count).toBe(0);
    const [handed] = drainRunSteering(90);
    expect(handed).toMatchObject({ text: 'for chat A', fromPerson: true, persist: true });
    expect(handed?.eventKey).toMatch(/^steer:/);
  });

  it('hands EVERY held turn of the chat left, oldest first - an addressed one goes back to the composer', async () => {
    type Turn = { text: string; to: string | null };
    const send = vi.fn();
    const restore = vi.fn();
    const props = (runKey: number): ChatTurnsOptions<Turn> => ({ running: true, steerable: false, runKey, send, restore, textOf: (t) => t.text, isDirected: (t) => t.to != null });
    const { result, rerender } = renderHook((p: ChatTurnsOptions<Turn>) => useChatTurns<Turn>(p), { initialProps: props(93) });
    await act(async () => { await result.current.queueAfter({ text: 'first', to: null }); });
    await act(async () => { await result.current.queueAfter({ text: '@dev second', to: 'dev' }); });
    await act(async () => { await result.current.queueAfter({ text: 'third', to: null }); });

    rerender(props(94));

    expect(drainRunSteering(93).map((m) => m.text)).toEqual(['first', 'third']);
    expect(restore).toHaveBeenCalledWith({ text: '@dev second', to: 'dev' });
    expect(result.current.queued.count).toBe(0);
  });

  it('a held turn a steer would drop (a file it cannot read) stays queued and is NOT jumped by the next message', async () => {
    type Turn = { text: string; files: Array<{ key: string; name: string; type: string; imageUrl?: string }> };
    const send = vi.fn();
    const notes = { key: 'n', name: 'notes.txt', type: 'text/plain' };
    const props = (steerable: boolean): ChatTurnsOptions<Turn> => ({ running: true, steerable, runKey: 92, send, textOf: (t) => t.text, attachmentsOf: (t) => t.files });
    const { result, rerender } = renderHook((p: ChatTurnsOptions<Turn>) => useChatTurns<Turn>(p), { initialProps: props(false) });
    await act(async () => { await result.current.submit({ text: 'read this file', files: [notes] }); });

    rerender(props(true)); // live: the file cannot ride a steer, so the turn stays queued
    expect(result.current.queued.count).toBe(1);
    await act(async () => { await result.current.submit({ text: 'and then this', files: [] }); });

    // ...and the later message waits behind it (held), instead of jumping it.
    expect(result.current.queued.items.map((i) => i.value.text)).toEqual(['read this file', 'and then this']);
    expect(drainRunSteering(92)).toEqual([]);
  });
});

describe('useChatTurns - a draft chat\'s first id is not a chat switch; everything left behind comes back together', () => {
  beforeEach(() => { stopRun.mockClear(); resetRunSteering(); resetBrainRunStore(); });

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
    expect(result.current.queued.count).toBe(0); // they left the queue for the chat's run...
    expect(drainRunSteering(77)).toEqual([]); // ...which is not live yet

    act(() => mirrorRun(77, true)); // its run goes live
    expect(drainRunSteering(77).map((m) => m.text)).toEqual(['B', 'C']);
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

    act(() => mirrorRun(78, false)); // the run ended
    expect(drainRunSteering(78).map((m) => m.text)).toEqual(['for later']);
    await act(async () => { finishFirst(true); });
  });

  type Turn = { text: string; to: string | null };
  const turnProps = (runKey: number, restore: (t: Turn) => void, join?: (t: readonly Turn[]) => Turn): ChatTurnsOptions<Turn> =>
    ({ running: true, steerable: false, runKey, send: vi.fn(), restore, join, textOf: (t) => t.text, isDirected: (t) => t.to != null }) as ChatTurnsOptions<Turn>;

  it('three held turns that go back to the composer are given back in ONE restore: texts in order, first addressee (BLOCKER)', async () => {
    const restore = vi.fn();
    const join = vi.fn((turns: readonly Turn[]): Turn => ({ text: turns.map((t) => t.text).join('\n\n'), to: turns.find((t) => t.to)?.to ?? null }));
    const { result, rerender } = renderHook((p: ChatTurnsOptions<Turn>) => useChatTurns<Turn>(p), { initialProps: turnProps(95, restore, join) });
    await act(async () => { await result.current.queueAfter({ text: '@dev one', to: 'dev' }); });
    await act(async () => { await result.current.queueAfter({ text: '@dev two', to: 'dev' }); });
    await act(async () => { await result.current.queueAfter({ text: '@ops three', to: 'ops' }); });

    rerender(turnProps(96, restore, join));

    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith({ text: '@dev one\n\n@dev two\n\n@ops three', to: 'dev' });
    expect(result.current.queued.count).toBe(0);
  });

  it('a single turn going back is restored as itself (no join), and the turns for the chat are handed on together, in order', async () => {
    const restore = vi.fn();
    const join = vi.fn();
    const { result, rerender } = renderHook((p: ChatTurnsOptions<Turn>) => useChatTurns<Turn>(p), { initialProps: turnProps(97, restore, join) });
    await act(async () => { await result.current.queueAfter({ text: 'first', to: null }); });
    await act(async () => { await result.current.queueAfter({ text: '@dev second', to: 'dev' }); });
    await act(async () => { await result.current.queueAfter({ text: 'third', to: null }); });

    rerender(turnProps(98, restore, join));

    expect(join).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith({ text: '@dev second', to: 'dev' });
    expect(drainRunSteering(97).map((m) => m.text)).toEqual(['first', 'third']);
  });
});

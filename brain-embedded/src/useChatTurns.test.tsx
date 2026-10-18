import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatTurns, type ChatTurnsOptions } from './useChatTurns';
import { useChatCreation } from './useChatCreation';

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

  it('queues while a run is in flight and flushes on its falling edge', async () => {
    const send = vi.fn();
    const { result, rerender } = mount({ running: true, runKey: 1, send });

    await act(async () => { await result.current.submit('next step'); });
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

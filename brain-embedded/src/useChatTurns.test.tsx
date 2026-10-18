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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatTurns, type ChatTurnsOptions } from './useChatTurns';
import { installRunDriver, type BrainRunDriver } from './runDriver';
import { drainRunSteering, resetRunSteering } from './runSteering';

const stopRun = vi.hoisted(() => vi.fn());
vi.mock('./brainRunStore', () => ({ stopRun }));

/**
 * A Stop's epoch is PER VIEW. A turn flushed from chat 70's queue is being sent (the VS Code send waits on its limbic fetch)
 * when the person switches to chat 50. A Stop on chat 50 is not that send's: if it were, the flush would return before putting
 * the turn anywhere - in no box, no queue, no chat.
 */
describe('useChatTurns - a flushed turn heeds only the Stops pressed on ITS view', () => {
  let steer: ReturnType<typeof vi.fn>;
  let restore: ReturnType<typeof vi.fn>;
  let settle: (kept: boolean) => void;

  const mount = async () => {
    steer = vi.fn();
    restore = vi.fn();
    installRunDriver({ start: vi.fn(), stop: vi.fn(), confirm: vi.fn(), clearError: vi.fn(), steer } as unknown as BrainRunDriver);
    const send = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const props = (running: boolean, runKey: number): ChatTurnsOptions<string> => ({ running, runKey, send, isDirected: () => false, restore });
    const hook = renderHook((p: ChatTurnsOptions<string>) => useChatTurns<string>(p), { initialProps: props(true, 70) });
    await act(async () => { await hook.result.current.queueAfter('T'); });
    await act(async () => { hook.rerender(props(false, 70)); }); // chat 70's run ended: T is flushed (the send is awaiting)
    expect(send).toHaveBeenCalledWith('T');
    return { ...hook, props };
  };

  beforeEach(() => { stopRun.mockReset(); resetRunSteering(); });
  afterEach(() => installRunDriver(null));

  it("a Stop on chat 50, switched to while T was being sent, does not drop T: not kept, it reaches chat 70 once - not the box, not the queue", async () => {
    const { result, rerender, props } = await mount();
    await act(async () => { rerender(props(false, 50)); });

    act(() => result.current.stop()); // Stop on chat 50
    expect(stopRun).toHaveBeenCalledWith(50);
    await act(async () => { settle(false); });

    expect(steer).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledWith(70, [expect.objectContaining({ text: 'T' })]);
    expect(restore).not.toHaveBeenCalled();
    expect(drainRunSteering(70)).toEqual([]);
    expect(result.current.queued.items).toEqual([]);
  });

  it("a Stop on chat 70 itself, then a switch away: T is the stopped conversation's - not delivered to chat 70, not put back", async () => {
    const { result, rerender, props } = await mount();

    act(() => result.current.stop()); // Stop on chat 70, T's own view
    expect(stopRun).toHaveBeenCalledWith(70);
    await act(async () => { rerender(props(false, 50)); });
    await act(async () => { settle(false); });

    expect(steer).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(drainRunSteering(70)).toEqual([]);
    expect(result.current.queued.items).toEqual([]);
  });
});

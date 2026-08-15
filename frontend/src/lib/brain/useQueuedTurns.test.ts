import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useQueuedTurns } from './useQueuedTurns';

/**
 * The rule under test is the one every composer in the product depends on: a run
 * in flight NEVER refuses input. What it does instead is hold the turn and send
 * it on the run's falling edge — exactly one per completed run, so two turns can
 * never race the same conversation.
 */
describe('useQueuedTurns', () => {
  const setup = (send = vi.fn()) => {
    const view = renderHook(
      ({ running, resetKey }: { running: boolean; resetKey?: string }) => useQueuedTurns({ running, send, resetKey }),
      { initialProps: { running: false, resetKey: 'chat-1' } },
    );
    return { view, send };
  };

  it('sends immediately when nothing is running', () => {
    const { view, send } = setup();
    let held = true;
    act(() => { held = view.result.current.submit('first'); });
    expect(held).toBe(false);
    expect(view.result.current.count).toBe(0);
    expect(send).not.toHaveBeenCalled(); // the caller sends; the queue only says "not mine"
  });

  it('holds a turn typed mid-run and flushes it when the run finishes', () => {
    const { view, send } = setup();
    view.rerender({ running: true, resetKey: 'chat-1' });

    let held = false;
    act(() => { held = view.result.current.submit('while thinking'); });
    expect(held).toBe(true);
    expect(view.result.current.count).toBe(1);
    expect(send).not.toHaveBeenCalled();

    act(() => { view.rerender({ running: false, resetKey: 'chat-1' }); });
    expect(send).toHaveBeenCalledWith('while thinking');
    expect(view.result.current.count).toBe(0);
  });

  it('flushes exactly one turn per completed run', () => {
    const { view, send } = setup();
    view.rerender({ running: true, resetKey: 'chat-1' });
    act(() => { view.result.current.submit('one'); view.result.current.submit('two'); });
    expect(view.result.current.count).toBe(2);

    act(() => { view.rerender({ running: false, resetKey: 'chat-1' }); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('one');
    expect(view.result.current.count).toBe(1);

    // The flushed turn starts its own run; the next falling edge releases the rest.
    act(() => { view.rerender({ running: true, resetKey: 'chat-1' }); });
    act(() => { view.rerender({ running: false, resetKey: 'chat-1' }); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('two');
    expect(view.result.current.count).toBe(0);
  });

  it('drops everything held when the run is stopped', () => {
    const { view, send } = setup();
    view.rerender({ running: true, resetKey: 'chat-1' });
    act(() => { view.result.current.submit('queued behind a stopped run'); });

    act(() => { view.result.current.clear(); });
    act(() => { view.rerender({ running: false, resetKey: 'chat-1' }); });

    expect(view.result.current.count).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('discards held turns when the conversation changes', () => {
    const { view, send } = setup();
    view.rerender({ running: true, resetKey: 'chat-1' });
    act(() => { view.result.current.submit('meant for chat 1'); });

    act(() => { view.rerender({ running: true, resetKey: 'chat-2' }); });
    act(() => { view.rerender({ running: false, resetKey: 'chat-2' }); });

    expect(send).not.toHaveBeenCalled();
    expect(view.result.current.count).toBe(0);
  });

  it('ignores blank input', () => {
    const { view } = setup();
    view.rerender({ running: true, resetKey: 'chat-1' });
    let held = true;
    act(() => { held = view.result.current.submit('   '); });
    expect(held).toBe(false);
    expect(view.result.current.count).toBe(0);
  });
});

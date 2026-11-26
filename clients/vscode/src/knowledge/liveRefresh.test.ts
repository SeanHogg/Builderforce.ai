import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttledRefresh } from './liveRefresh';

const WINDOW = 1000;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('throttledRefresh', () => {
  it('does not start a second refresh while a slower-than-the-window one is still running', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const t = throttledRefresh(refresh, WINDOW);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(refresh).toHaveBeenCalledTimes(1);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW * 5);
    expect(refresh).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    t.dispose();
  });

  it('runs ONE trailing refresh a window after the run settled when requested during the run', async () => {
    const finishers: Array<() => void> = [];
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finishers.push(resolve); }));
    const t = throttledRefresh(refresh, WINDOW);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(refresh).toHaveBeenCalledTimes(1);

    t.request();
    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW * 3); // the run takes 3 windows
    finishers[0]!();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(WINDOW - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    finishers[1]!();
    await vi.advanceTimersByTimeAsync(WINDOW * 5);
    expect(refresh).toHaveBeenCalledTimes(2); // only one trailing run
    t.dispose();
  });

  it('dispose drops the trailing run', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const t = throttledRefresh(refresh, WINDOW);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    t.request();
    t.dispose();
    finish();
    await vi.advanceTimersByTimeAsync(WINDOW * 5);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('opens the window again after a rejected run', async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error('aborted')).mockResolvedValue(undefined);
    const t = throttledRefresh(refresh, WINDOW);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(refresh).toHaveBeenCalledTimes(1);
    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(refresh).toHaveBeenCalledTimes(2);
    t.dispose();
  });
});

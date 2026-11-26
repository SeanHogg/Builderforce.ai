import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settledThrottle } from './settledThrottle';

const WINDOW = 1000;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('settledThrottle', () => {
  it('does not start a second run while a slower-than-the-window one is still running', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const t = settledThrottle(refresh, WINDOW);

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

  it('runs ONE trailing run a window after the run settled when requested during the run', async () => {
    const finishers: Array<() => void> = [];
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finishers.push(resolve); }));
    const t = settledThrottle(refresh, WINDOW);

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
    const t = settledThrottle(refresh, WINDOW);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    t.request();
    t.dispose();
    finish();
    await vi.advanceTimersByTimeAsync(WINDOW * 5);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a request after dispose, mid-run, schedules nothing', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const t = settledThrottle(refresh, WINDOW);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    t.dispose();
    t.request(); // mid-run, after dispose
    finish();
    await vi.advanceTimersByTimeAsync(WINDOW * 5);
    expect(refresh).toHaveBeenCalledTimes(1);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW * 5);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('opens the window again after a rejected run', async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error('aborted')).mockResolvedValue(undefined);
    const t = settledThrottle(refresh, WINDOW);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(refresh).toHaveBeenCalledTimes(1);
    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(refresh).toHaveBeenCalledTimes(2);
    t.dispose();
  });

  it('a synchronous throw settles the run and the window reopens', async () => {
    const refresh = vi.fn(() => { throw new Error('boom'); });
    const t = settledThrottle(refresh, WINDOW);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(refresh).toHaveBeenCalledTimes(1);
    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(refresh).toHaveBeenCalledTimes(2);
    t.dispose();
  });

  it('a non-promise return settles at once', async () => {
    const refresh = vi.fn(() => undefined);
    const t = settledThrottle(refresh, WINDOW);

    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW);
    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    t.dispose();
  });

  it('leading: the first request runs at once, the next waits a window from the settle', async () => {
    const refresh = vi.fn(() => undefined);
    const t = settledThrottle(refresh, WINDOW, { leading: true });

    t.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    t.request();
    await vi.advanceTimersByTimeAsync(WINDOW - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    t.dispose();
  });
});

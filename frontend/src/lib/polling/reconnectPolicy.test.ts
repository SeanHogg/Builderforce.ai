/** @vitest-environment jsdom */
// Visibility is part of the policy, so this suite needs a document (src/lib defaults to node).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReconnector, RECONNECT_BASE_MS, RECONNECT_MAX_MS, MAX_UNOPENED_ATTEMPTS, STABLE_OPEN_MS } from './reconnectPolicy';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('createReconnector — the one reconnect policy', () => {
  beforeEach(() => { vi.useFakeTimers(); setVisibility('visible'); });
  afterEach(() => { vi.useRealTimers(); setVisibility('visible'); });

  it('backs off, doubling per failure up to the ceiling', () => {
    const waits: number[] = [];
    const connect = vi.fn(() => reconnector.closed());
    const reconnector = createReconnector({ connect, onRetryScheduled: (ms) => waits.push(ms), maxUnopenedAttempts: 20 });
    reconnector.start();
    for (let i = 0; i < 7; i += 1) vi.advanceTimersByTime(waits.at(-1)!);
    expect(waits.slice(0, 7)).toEqual([RECONNECT_BASE_MS, 4_000, 8_000, 16_000, 32_000, RECONNECT_MAX_MS, RECONNECT_MAX_MS]);
    reconnector.stop();
  });

  it('never retries an auth close code, even when the tab comes back', () => {
    const onGiveUp = vi.fn();
    const connect = vi.fn();
    const reconnector = createReconnector({ connect, onGiveUp });
    reconnector.start();
    reconnector.closed(4401);
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 2);
    setVisibility('hidden');
    setVisibility('visible');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith('auth');
    reconnector.stop();
  });

  it('gives up after a run of attempts that never opened, and a visibility regain grants a fresh round', () => {
    const onGiveUp = vi.fn();
    const connect = vi.fn(() => reconnector.closed(1006));
    const reconnector = createReconnector({ connect, onGiveUp });
    reconnector.start();
    vi.advanceTimersByTime(60 * 60_000);
    expect(connect).toHaveBeenCalledTimes(MAX_UNOPENED_ATTEMPTS);
    expect(onGiveUp).toHaveBeenCalledWith('unopened');

    connect.mockImplementation(() => undefined);
    setVisibility('hidden');
    setVisibility('visible');
    expect(connect).toHaveBeenCalledTimes(MAX_UNOPENED_ATTEMPTS + 1);
    reconnector.stop();
  });

  it('waits while the tab is hidden and reconnects on return', () => {
    const connect = vi.fn();
    const reconnector = createReconnector({ connect });
    reconnector.start();
    setVisibility('hidden');
    reconnector.closed(1006);
    vi.advanceTimersByTime(RECONNECT_MAX_MS);
    expect(connect).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(connect).toHaveBeenCalledTimes(2);
    reconnector.stop();
  });

  it('resets to the short wait only after a connection that held', () => {
    const waits: number[] = [];
    const connect = vi.fn();
    const reconnector = createReconnector({ connect, onRetryScheduled: (ms) => waits.push(ms) });
    reconnector.start();
    // Accepted and dropped at once: no reset, the wait keeps growing.
    reconnector.opened();
    reconnector.closed(1006);
    vi.advanceTimersByTime(waits.at(-1)!);
    reconnector.opened();
    reconnector.closed(1006);
    expect(waits).toEqual([RECONNECT_BASE_MS, 4_000]);
    vi.advanceTimersByTime(waits.at(-1)!);
    // Held past the stable window: the next drop starts short again.
    reconnector.opened();
    vi.advanceTimersByTime(STABLE_OPEN_MS);
    reconnector.closed(1006);
    expect(waits.at(-1)).toBe(RECONNECT_BASE_MS);
    reconnector.stop();
  });

  it('stops when the caller says a retry is pointless, and after stop()', () => {
    let tokenStillValid = true;
    const onGiveUp = vi.fn();
    const connect = vi.fn();
    const reconnector = createReconnector({ connect, onGiveUp, canRetry: () => tokenStillValid });
    reconnector.start();
    tokenStillValid = false;
    reconnector.closed(1006);
    vi.advanceTimersByTime(RECONNECT_MAX_MS);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith('stale');

    tokenStillValid = true;
    reconnector.stop();
    setVisibility('hidden');
    setVisibility('visible');
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeated close for the same attempt', () => {
    const waits: number[] = [];
    const reconnector = createReconnector({ connect: vi.fn(), onRetryScheduled: (ms) => waits.push(ms) });
    reconnector.start();
    reconnector.closed(1006);
    reconnector.closed(1006);
    expect(waits).toEqual([RECONNECT_BASE_MS]);
    reconnector.stop();
  });
});

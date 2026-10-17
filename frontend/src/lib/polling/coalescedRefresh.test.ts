import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalescedRefresh } from './coalescedRefresh';
import { reportBackgroundFailure } from '../reportError';

vi.mock('../reportError', () => ({ reportBackgroundFailure: vi.fn(async () => true) }));

/** A burst of relay frames is one fetch; frames during a fetch earn exactly one follow-up. */
describe('createCoalescedRefresh', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('merges a burst inside the window into one call', async () => {
    const run = vi.fn(async () => undefined);
    const refresh = createCoalescedRefresh(run, 400);
    for (let i = 0; i < 10; i += 1) { refresh.trigger(); await vi.advanceTimersByTimeAsync(30); }
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('bounds latency: a steady stream still fires once per window', async () => {
    const run = vi.fn(async () => undefined);
    const refresh = createCoalescedRefresh(run, 400);
    for (let i = 0; i < 12; i += 1) { refresh.trigger(); await vi.advanceTimersByTimeAsync(100); }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('holds one call in flight and runs one follow-up only if frames arrived during it', async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const refresh = createCoalescedRefresh(run, 400);
    refresh.trigger();
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledTimes(1);
    refresh.trigger();
    refresh.trigger();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('survives a failed call and stops after cancel', async () => {
    const run = vi.fn(async () => { throw new Error('offline'); });
    const refresh = createCoalescedRefresh(run, 400);
    refresh.trigger();
    await vi.advanceTimersByTimeAsync(400);
    refresh.trigger();
    refresh.cancel();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(1);
    // The failure is recorded, not swallowed.
    expect(vi.mocked(reportBackgroundFailure)).toHaveBeenCalledTimes(1);
  });
});

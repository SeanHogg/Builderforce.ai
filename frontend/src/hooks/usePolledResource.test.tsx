import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { usePolledResource, type PolledResourceOptions } from './usePolledResource';

function Harness({ load, options }: { load: (signal: AbortSignal) => unknown; options: PolledResourceOptions }) {
  usePolledResource(load, options);
  return null;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('usePolledResource', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('loads immediately, then once per interval, and stops on unmount', async () => {
    const load = vi.fn(async () => undefined);
    const view = render(<Harness load={load} options={{ intervalMs: 1000 }} />);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(load).toHaveBeenCalledTimes(3);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('backs off after a rejected load and resets after a good one', async () => {
    let fail = true;
    const load = vi.fn(async () => { if (fail) throw new Error('down'); });
    render(<Harness load={load} options={{ intervalMs: 1000, immediate: false }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });   // tick 1 fails → wait 2s
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });   // 1s later: nothing yet
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });   // 2s: tick 2 fails → wait 4s
    expect(load).toHaveBeenCalledTimes(2);
    fail = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });   // tick 3 succeeds → back to 1s
    expect(load).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('does not tick while hidden and loads once on return', async () => {
    const load = vi.fn(async () => undefined);
    render(<Harness load={load} options={{ intervalMs: 1000, immediate: false }} />);
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(load).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(load).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it('stops after maxTicks and never overlaps an in-flight load', async () => {
    let resolve: (() => void) | null = null;
    const load = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<Harness load={load} options={{ intervalMs: 100, immediate: false, maxTicks: 2 }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(load).toHaveBeenCalledTimes(1);
    // The first load is still pending: the next tick must not start a second one.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { resolve?.(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => { resolve?.(); await vi.advanceTimersByTimeAsync(1000); });
    expect(load).toHaveBeenCalledTimes(2); // maxTicks reached
  });

  it('aborts the signal handed to load when the poll is disabled', async () => {
    const seen: AbortSignal[] = [];
    const load = vi.fn(async (signal: AbortSignal) => { seen.push(signal); });
    const view = render(<Harness load={load} options={{ intervalMs: 1000, enabled: true }} />);
    await flush();
    expect(seen[0]?.aborted).toBe(false);
    view.rerender(<Harness load={load} options={{ intervalMs: 1000, enabled: false }} />);
    expect(seen[0]?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

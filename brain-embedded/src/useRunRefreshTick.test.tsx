import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRunRefreshTick } from './useRunRefreshTick';

afterEach(() => { vi.useRealTimers(); });

describe('useRunRefreshTick', () => {
  it('ticks while a run goes and once when it settles, never while idle', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ running }) => useRunRefreshTick(running, 1000), { initialProps: { running: false } });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(0);

    rerender({ running: true });
    act(() => { vi.advanceTimersByTime(2500); });
    expect(result.current).toBe(2);

    rerender({ running: false });
    expect(result.current).toBe(3);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(3);
  });
});

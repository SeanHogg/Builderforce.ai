// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { scheduleIdle } from './idle';
import { useDeferredWhen } from './useDeferredWhen';
import { useIdleValue } from './useIdleValue';

const flush = (): void => { act(() => { vi.runAllTimers(); }); };

describe('useIdleValue', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('computes on idle, not during render', () => {
        const compute = vi.fn(() => 7);
        const { result } = renderHook(() => useIdleValue(compute, []));
        expect(result.current).toBeNull();
        expect(compute).not.toHaveBeenCalled();
        flush();
        expect(result.current).toBe(7);
    });

    it('clears the old value when deps change (it answers a question nobody asks any more)', () => {
        const { result, rerender } = renderHook(({ k }) => useIdleValue(() => k * 2, [k]), { initialProps: { k: 1 } });
        flush();
        expect(result.current).toBe(2);
        rerender({ k: 2 });
        expect(result.current).toBeNull();
        flush();
        expect(result.current).toBe(4);
    });

    it('keeps the old value while the next computes when a fallback is given', () => {
        const { result, rerender } = renderHook(({ k }) => useIdleValue(() => k * 2, [k], -1), { initialProps: { k: 1 } });
        flush();
        rerender({ k: 2 });
        expect(result.current).toBe(2);
        flush();
        expect(result.current).toBe(4);
    });

    it('settles on the fallback, and logs, when the computation throws', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { result } = renderHook(() => useIdleValue<number>(() => { throw new Error('boom'); }, [], 0));
        flush();
        expect(result.current).toBe(0);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('never applies a stale result: a change of deps or an unmount cancels the pending callback', () => {
        const compute = vi.fn(() => 1);
        const { unmount } = renderHook(() => useIdleValue(compute, []));
        unmount();
        flush();
        expect(compute).not.toHaveBeenCalled();
    });
});

describe('scheduleIdle', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('asks for an idle callback with a timeout, and cancels it', () => {
        const request = vi.fn(() => 42);
        const cancel = vi.fn();
        vi.stubGlobal('requestIdleCallback', request);
        vi.stubGlobal('cancelIdleCallback', cancel);
        const stop = scheduleIdle(() => undefined);
        expect(request).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 });
        stop();
        expect(cancel).toHaveBeenCalledWith(42);
    });

    it('falls back to a cancellable timeout', () => {
        const cb = vi.fn();
        scheduleIdle(cb)();
        vi.runAllTimers();
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('useDeferredWhen', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('computes in the same render for small work and schedules nothing', () => {
        const compute = vi.fn(() => 'now');
        const { result } = renderHook(() => useDeferredWhen(compute, [], false));
        expect(result.current).toBe('now');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('defers big work to an idle callback', () => {
        const { result } = renderHook(() => useDeferredWhen(() => 'later', [], true));
        expect(result.current).toBeNull();
        flush();
        expect(result.current).toBe('later');
    });
});

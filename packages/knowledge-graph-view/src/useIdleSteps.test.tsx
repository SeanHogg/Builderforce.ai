// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SLICE_MS, useIdleSteps, type IdleTask } from './useIdleSteps';

/** A task of `n` steps; each step spends a whole slice, so the hook yields to the next idle callback after every step. */
function slowTask(label: string, n: number, log: string[]): IdleTask<string> {
    let done = 0;
    return {
        step() {
            log.push(`${label}:${done}`);
            done++;
            vi.setSystemTime(Date.now() + SLICE_MS + 1);
            return done >= n;
        },
        result: () => `${label} done`,
    };
}

/** Runs exactly the idle callbacks that are pending now (one slice), not the ones they schedule in turn. */
const tick = (): void => { act(() => { vi.runOnlyPendingTimers(); }); };
/** Runs every callback until the hook has nothing left scheduled. */
const flush = (): void => { act(() => { vi.runAllTimers(); }); };

describe('useIdleSteps', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('runs a task a slice at a time and applies its result once', () => {
        const log: string[] = [];
        const { result } = renderHook(() => useIdleSteps(() => slowTask('a', 3, log), []));
        expect(result.current).toBeNull();
        tick(); expect(log).toEqual(['a:0']);
        tick(); tick();
        expect(log).toEqual(['a:0', 'a:1', 'a:2']);
        expect(result.current).toBe('a done');
    });

    it('stops the task on unmount: no further steps, no result applied', () => {
        const log: string[] = [];
        const { unmount } = renderHook(() => useIdleSteps(() => slowTask('a', 5, log), []));
        tick();
        unmount();
        flush();
        expect(log).toEqual(['a:0']);
    });

    it('cancels the running task when deps change, and never applies its result (no stale apply)', () => {
        const log: string[] = [];
        const { result, rerender } = renderHook(({ k }) => useIdleSteps(() => slowTask(k, k === 'old' ? 3 : 2, log), [k]), { initialProps: { k: 'old' } });
        tick(); // old:0
        rerender({ k: 'new' });
        flush();
        expect(log.filter((l) => l.startsWith('old'))).toEqual(['old:0']);
        expect(log.filter((l) => l.startsWith('new'))).toEqual(['new:0', 'new:1']);
        expect(result.current).toBe('new done');
    });

    it('settles on the fallback when the task throws, instead of staying null', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { result } = renderHook(() => useIdleSteps<string>(() => { throw new Error('boom'); }, [], 'empty'));
        tick();
        expect(result.current).toBe('empty');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

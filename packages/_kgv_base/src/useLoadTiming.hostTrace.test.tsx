// @vitest-environment jsdom
/** The host-trace poll: it runs only while a load does, re-renders only on a change, and survives a read the host never answers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { LoadTrace } from './loadTraceTypes';
import type { KnowledgeGraphSource } from './types';
import { loadRunning, TRACE_POLL_MS, TRACE_READ_TIMEOUT_MS, TRACE_SETTLE_MS, useHostLoadTrace } from './useLoadTiming';

const trace = (now: number, phase = 'build'): LoadTrace => ({
    now, entries: [], inFlight: [{ op: 'load', rootId: 'r', startedAt: 1, phases: [{ phase, startedAt: 2 }] }],
});

const sourceOf = (loadTrace: () => Promise<LoadTrace>): KnowledgeGraphSource => ({ loadTrace } as unknown as KnowledgeGraphSource);

/** Lets the settled reads' callbacks run. */
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('useHostLoadTrace', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('a failed refresh is not a running load: the poll is off once refreshFailed is set', () => {
        expect(loadRunning('loading', false, false)).toBe(true);
        expect(loadRunning('ready', true, false)).toBe(true);
        // useKnowledgeGraph leaves `stale` set beside `refreshFailed`: that must not keep the 1 s poll alive.
        expect(loadRunning('ready', true, true)).toBe(false);
        expect(loadRunning('ready', false, false)).toBe(false);
    });

    it('stops polling when the load stops running (a failed refresh): one settle read, then nothing', async () => {
        let n = 0;
        const loadTrace = vi.fn(() => Promise.resolve(trace(++n)));
        const source = sourceOf(loadTrace);
        const { rerender } = renderHook(({ active }) => useHostLoadTrace(source, active), { initialProps: { active: true } });
        await flush();
        for (let i = 0; i < 3; i++) {
            await act(async () => { vi.advanceTimersByTime(TRACE_POLL_MS); });
            await flush();
        }
        const whileRunning = loadTrace.mock.calls.length;
        expect(whileRunning).toBeGreaterThanOrEqual(3);
        rerender({ active: loadRunning('ready', true, true) });
        await flush();
        await act(async () => { vi.advanceTimersByTime(TRACE_SETTLE_MS); });
        await flush();
        const settled = loadTrace.mock.calls.length;
        await act(async () => { vi.advanceTimersByTime(TRACE_POLL_MS * 30); });
        expect(loadTrace.mock.calls.length).toBe(settled);
        expect(settled - whileRunning).toBeLessThanOrEqual(2); // the read as it ends, and the settle read
    });

    it('sets no state when an answer changes nothing a reader sees, but keeps the latest for Diagnostics', async () => {
        let n = 0;
        const source = sourceOf(() => Promise.resolve(trace(++n)));
        let renders = 0;
        const { result } = renderHook(() => { renders += 1; return useHostLoadTrace(source, true); });
        await flush();
        expect(result.current.trace?.inFlight[0]!.phases[0]!.phase).toBe('build');
        const settledRenders = renders;
        const first = result.current.trace;
        for (let i = 0; i < 5; i++) {
            await act(async () => { vi.advanceTimersByTime(TRACE_POLL_MS); });
            await flush();
        }
        expect(renders).toBe(settledRenders);
        expect(result.current.trace).toBe(first);
        expect(result.current.latest()!.now).toBe(n);
    });

    it('re-renders when the trace does change (a new phase)', async () => {
        let phase = 'partitions';
        const source = sourceOf(() => Promise.resolve(trace(Date.now(), phase)));
        const { result } = renderHook(() => useHostLoadTrace(source, true));
        await flush();
        expect(result.current.trace?.inFlight[0]!.phases[0]!.phase).toBe('partitions');
        phase = 'index';
        await act(async () => { vi.advanceTimersByTime(TRACE_POLL_MS); });
        await flush();
        expect(result.current.trace?.inFlight[0]!.phases[0]!.phase).toBe('index');
    });

    it('a read the host never settles does not kill the poll: it is dropped after the timeout and the next tick reads again', async () => {
        const answers: ((t: LoadTrace) => void)[] = [];
        const loadTrace = vi.fn(() => new Promise<LoadTrace>((resolve) => { answers.push(resolve); }));
        const source = sourceOf(loadTrace);
        const { result } = renderHook(() => useHostLoadTrace(source, true));
        await act(async () => { vi.advanceTimersByTime(TRACE_POLL_MS * 2); });
        expect(loadTrace).toHaveBeenCalledTimes(1); // the first read is still out
        await act(async () => { vi.advanceTimersByTime(TRACE_READ_TIMEOUT_MS); });
        expect(loadTrace.mock.calls.length).toBeGreaterThanOrEqual(2);
        // The stuck read answering late is ignored; the live one is taken.
        answers[0]!(trace(1, 'stuck'));
        answers[answers.length - 1]!(trace(2, 'build'));
        await flush();
        expect(result.current.trace?.inFlight[0]!.phases[0]!.phase).toBe('build');
    });
});

// @vitest-environment jsdom
/** useRunTraces: one read per root and per sources tick (never per graph patch), no flicker on a re-read, a failed read is reported. */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { KnowledgeGraphSource, RunTraces } from '../../types';
import { useRunTraces } from './useRunTraces';

const base: KnowledgeGraphSource = { scopes: async () => [], load: async () => null };
const traces = (id: string): RunTraces => ({ runs: [{ id, at: '2026-11-27T00:00:00Z', steps: [] }], skippedLines: 0 });

describe('useRunTraces', () => {
    it('reads once per root, again only when the sources tick moves, and keeps the previous runs while it re-reads', async () => {
        let release!: (t: RunTraces) => void;
        const runTraces = vi.fn().mockResolvedValueOnce(traces('a')).mockImplementationOnce(() => new Promise<RunTraces>((r) => { release = r; }));
        const source = { ...base, runTraces };
        const { result, rerender } = renderHook(({ tick }) => useRunTraces(source, 'r', tick), { initialProps: { tick: 0 } });
        await waitFor(() => expect(result.current?.runs[0]?.id).toBe('a'));
        rerender({ tick: 0 });
        expect(runTraces).toHaveBeenCalledTimes(1);
        rerender({ tick: 1 });
        expect(result.current?.runs[0]?.id).toBe('a'); // in flight: no null flicker
        release(traces('b'));
        await waitFor(() => expect(result.current?.runs[0]?.id).toBe('b'));
    });

    it('reports a failed read through the source\'s decision log and gives no runs', async () => {
        const decision = vi.fn();
        const source = { ...base, decision, runTraces: vi.fn().mockRejectedValue(new Error('disk')) };
        const { result } = renderHook(() => useRunTraces(source, 'r', 0));
        await waitFor(() => expect(decision).toHaveBeenCalledWith({ kind: 'error', reason: 'run traces read failed: disk', rootId: 'r' }));
        expect(result.current).toBeNull();
    });

    it('is null for a host without the port', () => {
        expect(renderHook(() => useRunTraces(base, 'r', 0)).result.current).toBeNull();
    });
});

// @vitest-environment jsdom
/**
 * regression: entering a station on the Map of a big graph (the hired.video root, worker-computed layout) turned the whole
 * VS Code webview black. `useComputed` reported `pending: false` in the render the deps changed in (the request is only made
 * in the effect after it), so the transit map drew the PREVIOUS level's routes against the NEW level's lines and
 * `lineById.get(r.lineId)!.colourIndex` threw. The previous answer may still be shown, but never as the answer to the new deps.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useComputed } from './useComputed';

interface Pending { input: unknown; done(value: unknown): void }
const runs = vi.hoisted((): Pending[] => []);

vi.mock('./sharedClient', () => {
    const client = {
        retain: () => undefined,
        release: () => undefined,
        runSync: () => null,
        run: (_kind: string, input: unknown, cb: { done(value: unknown): void }) => {
            runs.push({ input, done: cb.done });
            return () => undefined;
        },
    };
    return { getComputeClient: () => client };
});


describe('useComputed pending', () => {
    it('is pending from the very render the deps change in, while the previous answer still shows', () => {
        const seen: Array<{ dep: string; value: unknown; pending: boolean }> = [];
        const { rerender } = renderHook(({ dep }: { dep: string }) => {
            const got = useComputed('insights', { graph: dep } as never, [dep], null);
            seen.push({ dep, value: got.value, pending: got.pending });
            return got;
        }, { initialProps: { dep: 'world' } });

        act(() => runs[runs.length - 1]!.done('world-answer'));
        expect(seen[seen.length - 1]).toEqual({ dep: 'world', value: 'world-answer', pending: false });

        const before = seen.length;
        rerender({ dep: 'level' });
        // The first render with the new deps: the old answer is kept, and it says it is not the new deps' answer.
        expect(seen[before]).toEqual({ dep: 'level', value: 'world-answer', pending: true });
        for (const s of seen.slice(before)) expect(s.pending).toBe(true);

        act(() => runs[runs.length - 1]!.done('level-answer'));
        expect(seen[seen.length - 1]).toEqual({ dep: 'level', value: 'level-answer', pending: false });
    });
});

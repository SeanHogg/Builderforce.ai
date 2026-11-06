// @vitest-environment jsdom
/** useRecordedRun: read the host's recorded values once per path, and never invent one. */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { RecordedRun } from '../../fixPorts';
import type { KnowledgeGraphSource } from '../../types';
import { useRecordedRun } from './useRecordedRun';

const base: KnowledgeGraphSource = { scopes: async () => [], load: async () => null };
const run = (value: string): RecordedRun => ({ values: [{ stopId: 'a', name: 'amount', value, direction: 'in' }] });
const mount = (source: KnowledgeGraphSource | undefined, rootId: string | undefined, stops: string[]) =>
    renderHook((p: { stops: string[] }) => useRecordedRun(source, rootId, p.stops), { initialProps: { stops } });

describe('useRecordedRun', () => {
    it('reads the host\'s values for the path\'s stops', async () => {
        const recordedValues = vi.fn(async () => run('100'));
        const h = mount({ ...base, recordedValues }, 'r', ['a', 'b']);
        expect(h.result.current.loading).toBe(true);
        await waitFor(() => expect(h.result.current.run).toEqual(run('100')));
        expect(h.result.current.loading).toBe(false);
        expect(recordedValues).toHaveBeenCalledWith('r', ['a', 'b']);
    });

    it('has nothing, and never asks, without the port, a root or a path', () => {
        const recordedValues = vi.fn(async () => run('1'));
        for (const h of [mount(base, 'r', ['a']), mount({ ...base, recordedValues }, undefined, ['a']), mount({ ...base, recordedValues }, 'r', [])]) {
            expect(h.result.current).toEqual({ run: null, loading: false });
        }
        expect(recordedValues).not.toHaveBeenCalled();
    });

    it('reads a failed call as nothing recorded', async () => {
        const h = mount({ ...base, recordedValues: vi.fn().mockRejectedValue(new Error('no traces')) }, 'r', ['a']);
        await waitFor(() => expect(h.result.current.loading).toBe(false));
        expect(h.result.current.run).toBeNull();
    });

    it('asks again when the path changes and never shows the old path\'s values for the new one', async () => {
        const recordedValues = vi.fn(async (_root: string, stops: string[]) => run(stops.join('+')));
        const h = mount({ ...base, recordedValues }, 'r', ['a']);
        await waitFor(() => expect(h.result.current.run).toEqual(run('a')));
        h.rerender({ stops: ['a', 'b'] });
        expect(h.result.current.run).toBeNull(); // the old values are not the new path's
        expect(h.result.current.loading).toBe(true);
        await waitFor(() => expect(h.result.current.run).toEqual(run('a+b')));
        expect(recordedValues).toHaveBeenCalledTimes(2);
    });

    it('drops a late answer for a path that is no longer shown', async () => {
        const pending: Array<(r: RecordedRun) => void> = [];
        const recordedValues = vi.fn(() => new Promise<RecordedRun>((resolve) => { pending.push(resolve); }));
        const h = mount({ ...base, recordedValues }, 'r', ['a']);
        h.rerender({ stops: ['b'] });
        pending[0]!(run('stale'));
        pending[1]!(run('fresh'));
        await waitFor(() => expect(h.result.current.run).toEqual(run('fresh')));
    });
});

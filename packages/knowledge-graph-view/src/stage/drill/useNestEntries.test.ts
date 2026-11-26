import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DrillFrame } from '../../surface/transit/drillView';
import type { DrillModel } from '../../surface/transit/useDrill';
import type { Placement } from '../types';
import { nestEntryOf, type NestBasis } from './nest';
import { useNestEntries } from './useNestEntries';

function placementOf(generation: number, drill: string, slots: ReadonlyArray<readonly [number, number, number]>): Placement {
    const n = slots.length;
    const position = new Float32Array(n * 3), scale = new Float32Array(n);
    slots.forEach(([x, z, s], i) => { position[i * 3] = x; position[i * 3 + 2] = z; scale[i] = s; });
    return {
        generation, cacheKey: `k|map|${drill}`, position, scale, extrude: new Float32Array(n), links: [], planes: [], captions: [], labels: [],
        bounds: { min: [0, 0, 0], max: [10, 0, 10] }, rig: {}, a11y: [],
    } as unknown as Placement;
}

const pkg = (ref: string): DrillFrame => ({ level: 'package', ref, name: ref });
const drillOf = (stack: DrillFrame[], moves: ReadonlyMap<string, string> = new Map()) =>
    ({ stack, reanchored: { seq: moves.size ? 1 : 0, moves } }) as unknown as DrillModel;

describe('useNestEntries', () => {
    it('nests a placement by its own generation\'s entry only, and passes an unentered level through', () => {
        const drill = drillOf([pkg('p1')]);
        const { result } = renderHook(() => useNestEntries(drill));
        const world = placementOf(1, '', [[4, 6, 2]]);
        const level = placementOf(1, 'package:p1', [[1, 1, 1]]);
        expect(result.current.nest(level)).toBe(level);
        act(() => result.current.add(nestEntryOf(world, 0, 'package:p1')!));
        expect(result.current.nest(level)).not.toBe(level);
        const regenerated = placementOf(2, 'package:p1', [[1, 1, 1]]);
        expect(result.current.nest(regenerated)).toBe(regenerated); // the entry is of generation 1
        expect(result.current.awaitsBasis(regenerated)).toBe(true);
    });

    it('re-derives the entries from a generation-matched basis, so the regenerated level stays nested in its mark', () => {
        const drill = drillOf([pkg('p1')]);
        const { result } = renderHook(() => useNestEntries(drill));
        act(() => result.current.add(nestEntryOf(placementOf(1, '', [[4, 6, 2]]), 0, 'package:p1')!));
        const regenerated = placementOf(2, 'package:p1', [[1, 1, 1]]);
        const basis: NestBasis = { marks: { generation: 2, keys: ['st:p1'] }, levels: [placementOf(2, '', [[7, 3, 2]])] };
        act(() => result.current.setBasis(basis));
        expect(result.current.awaitsBasis(regenerated)).toBe(false);
        // The regenerated level stays nested in its mark: against the NEW world's slot (7, 3), not the one it was entered from (4, 6).
        const out = result.current.nest(regenerated);
        expect(out).not.toBe(regenerated);
        expect(out.cacheKey).toContain('|nest:7,0,3:4');
        expect(result.current.entries.get('package:p1')!.centre).toEqual([7, 0, 3]);
        // A basis whose MarkSet and placements disagree on the generation derives nothing, so nothing is nested by it.
        act(() => result.current.setBasis({ ...basis, marks: { generation: 3, keys: ['st:p1'] } }));
        expect(result.current.nest(regenerated)).toBe(regenerated);
    });

    it('carries the entry of a package the drill moved to its new key, overwriting what was there', () => {
        const world = placementOf(1, '', [[4, 6, 2]]);
        let drill = drillOf([pkg('old')]);
        const { result, rerender } = renderHook(() => useNestEntries(drill));
        act(() => result.current.add(nestEntryOf(world, 0, 'package:old')!));
        drill = drillOf([pkg('new')], new Map([['old', 'new']]));
        rerender();
        expect(result.current.entries.has('package:old')).toBe(false);
        expect(result.current.entries.get('package:new')).toMatchObject({ drill: 'package:new', centre: [4, 0, 6] });
        expect(result.current.nests).toBe(true);
    });

    it('a chain that cannot be derived releases: the basis matches the generation, so nothing awaits it and the level is drawn un-nested', () => {
        const drill = drillOf([pkg('p1')]);
        const { result } = renderHook(() => useNestEntries(drill));
        act(() => result.current.add(nestEntryOf(placementOf(1, '', [[4, 6, 2]]), 0, 'package:p1')!));
        const regenerated = placementOf(2, 'package:p1', [[1, 1, 1]]);
        expect(result.current.awaitsBasis(regenerated)).toBe(true);
        // The MarkSet of the new generation has no mark for the package: nothing to nest into.
        act(() => result.current.setBasis({ marks: { generation: 2, keys: ['st:other'] }, levels: [placementOf(2, '', [[7, 3, 2]])] }));
        expect(result.current.awaitsBasis(regenerated)).toBe(false);
        expect(result.current.nest(regenerated)).toBe(regenerated);
    });
});

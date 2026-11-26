import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { Station, StationModel } from '../../surface/stations';
import type { DrillFrame } from '../../surface/transit/drillView';
import type { DrillModel } from '../../surface/transit/useDrill';
import { useStageMap } from './useStageMap';

const world = (ids: string[]): StationModel => {
    const stations = ids.map((id) => ({ id, name: id, refs: [`f-${id}`] }) as unknown as Station);
    return { stations, byId: new Map(stations.map((s) => [s.id, s] as const)), stationOf: new Map() };
};
const frame = (ref: string): DrillFrame => ({ level: 'package', ref, name: ref });
const drillOf = (ref: string, moves: ReadonlyMap<string, string>): DrillModel =>
    ({ stack: [frame(ref)], view: null, symbols: [], reanchored: { seq: moves.size, moves } }) as unknown as DrillModel;

describe('useStageMap across a re-anchored package', () => {
    it('carries an unfold made inside the package onto its new level key', () => {
        const index = new Map<string, KNode>();
        const slotOf = () => -1;
        const props = { w: world(['a']), d: drillOf('a', new Map()) };
        const { result, rerender } = renderHook(({ w, d }) => useStageMap(w, d, index, slotOf), { initialProps: props });
        expect(result.current.drill).toBe('package:a');
        act(() => result.current.toggleUnfold('a'));
        expect(result.current.unfolded).toBe('a');
        // The rebuilt map renumbered the package: same station content, new id; the frame followed it.
        rerender({ w: world(['a']), d: drillOf('b', new Map([['a', 'b']])) });
        expect(result.current.drill).toBe('package:b');
        expect(result.current.unfolded).toBe('a');
    });
});

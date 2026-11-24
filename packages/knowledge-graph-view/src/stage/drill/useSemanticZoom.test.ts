import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DrillModel } from '../../surface/transit/useDrill';
import type { SymbolRecord } from '../../types';
import type { StageBus } from '../anchor/stageBus';
import type { StageMap } from './useStageMap';
import { useSemanticZoom } from './useSemanticZoom';

const records: SymbolRecord[] = [
    { ref: 'src:sys::order.ts#place', name: 'place', kind: 'method', parent: 'src:sys::order.ts', line: 10, exported: false },
    { ref: 'src:sys::order.ts#reserve', name: 'reserve', kind: 'method', parent: 'src:sys::order.ts', line: 20, exported: false },
    { ref: 'src:sys::order.ts#charge', name: 'charge', kind: 'method', parent: 'src:sys::order.ts', line: 30, exported: false },
];
const keys = records.map((r) => `node:${r.ref}`);
const [place, reserve, charge] = records.map((r) => r.ref) as [string, string, string];

/** No placement and no rig: nothing flies, only the trail moves. */
const bus = { placement: null, projector: null, tweening: false, slotOf: (k: string | null) => (k ? keys.indexOf(k) : -1), onFrame: () => () => {}, onSettle: () => () => {} } as unknown as StageBus;
const drill = { stack: [{}, {}], view: null, symbols: records, canEnter: () => ({ can: false }), enter: vi.fn(), out: vi.fn() } as unknown as DrillModel;
const mapAt = (level: string) => ({ drill: level, symbols: records, stations: { stations: [], byId: new Map() }, keyOfStation: () => '' }) as unknown as StageMap;

function setup() {
    return renderHook(({ map }) => useSemanticZoom(bus, drill, map, true), { initialProps: { map: mapAt('class:a') } });
}
const names = (r: ReturnType<typeof setup>['result']) => r.current.trail.map((c) => c.name);

describe('the code band keeps a trail of drilled methods', () => {
    it('a drill from the code adds to the trail; Out goes back one method', () => {
        const { result } = setup();
        act(() => { result.current.enterCode(place); });
        act(() => { result.current.enterCode(reserve); });
        expect(names(result)).toEqual(['place', 'reserve']);
        expect(result.current.code?.target.ref).toBe(reserve);
        act(() => { result.current.closeCode(); });
        expect(names(result)).toEqual(['place']);
        expect(result.current.code?.target.ref).toBe(place);
    });

    it('a crumb cuts the trail back, and a method already on it is never duplicated', () => {
        const { result } = setup();
        act(() => { result.current.enterCode(place); });
        act(() => { result.current.enterCode(reserve); });
        act(() => { result.current.enterCode(charge); });
        act(() => { result.current.codeBack(0); });
        expect(names(result)).toEqual(['place']);
        act(() => { result.current.enterCode(reserve); });
        act(() => { result.current.enterCode(place); });
        expect(names(result)).toEqual(['place']);
    });

    it('a new drilled level clears it', () => {
        const { result, rerender } = setup();
        act(() => { result.current.enterCode(place); });
        rerender({ map: mapAt('class:b') });
        expect(result.current.trail).toEqual([]);
        expect(result.current.code).toBeNull();
    });
});

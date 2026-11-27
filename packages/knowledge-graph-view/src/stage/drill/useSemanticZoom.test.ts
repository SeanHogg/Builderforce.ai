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
const drill = { stack: [{}, {}], reanchored: { seq: 0, moves: new Map() }, view: null, symbols: records, canEnter: () => ({ can: false }), enter: vi.fn(), out: vi.fn(), climb: vi.fn() } as unknown as DrillModel;
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

    it('leaving the code from deep on the trail leaves it altogether (the pane closed, the level\'s crumb)', () => {
        const { result } = setup();
        act(() => { result.current.enterCode(place); });
        act(() => { result.current.enterCode(reserve); });
        act(() => { result.current.leaveCode(); });
        expect(result.current.trail).toEqual([]);
        expect(result.current.code).toBeNull();
    });

    it('a new drilled level clears it', () => {
        const { result, rerender } = setup();
        act(() => { result.current.enterCode(place); });
        rerender({ map: mapAt('class:b') });
        expect(result.current.trail).toEqual([]);
        expect(result.current.code).toBeNull();
    });
});

describe('the Map ladder goes back out to a band', () => {
    it('climbs the drill to a shallower band; a band at or past the current one does nothing', () => {
        const { result } = setup();
        act(() => { result.current.outToBand(2); });
        act(() => { result.current.outToBand(3); });
        expect(drill.climb).not.toHaveBeenCalled();
        act(() => { result.current.outToBand(0); });
        expect(drill.climb).toHaveBeenCalledWith(0);
    });

    it('from the code band, the method band leaves the code without climbing; a shallower one clears the trail and climbs', () => {
        const { result } = setup();
        act(() => { result.current.enterCode(place); });
        vi.mocked(drill.climb).mockClear();
        act(() => { result.current.outToBand(2); });
        expect(result.current.code).toBeNull();
        expect(drill.climb).not.toHaveBeenCalled();
        act(() => { result.current.enterCode(place); });
        act(() => { result.current.outToBand(1); });
        expect(result.current.trail).toEqual([]);
        expect(drill.climb).toHaveBeenCalledWith(1);
    });
});

describe('the 3D architecture camera uses the Map drill', () => {
    it('opens the file when a station crosses its semantic zoom threshold', () => {
        const ref = 'src:sys::app.ts';
        const station = { id: 'entry', refs: [ref], entry: true };
        const map = { ...mapAt(''), drill: null, stations: { stations: [station], byId: new Map([['entry', station]]) },
            keyOfStation: () => 'st:entry' } as unknown as StageMap;
        const openFile = vi.fn();
        const world = { ...drill, stack: [], canEnter: () => ({ can: true, level: 'package' }), openFile } as DrillModel;
        const camera = { ...bus, slotOf: () => 0, placement: { cacheKey: '1|3d||', scale: new Float32Array([10]),
            position: new Float32Array(3), extrude: new Float32Array(1) }, projector: {
            width: 400, height: 300, pxPerWorld: 10,
            project: (_x: number, _y: number, _z: number, out: Float64Array) => { out[0] = 200; out[1] = 150; return true; },
        } } as unknown as StageBus;
        renderHook(() => useSemanticZoom(camera, world, map, true));
        expect(openFile).toHaveBeenCalledWith(ref);
    });
});

describe('the Sequence band control sets the band itself', () => {
    it('an explicit click on System sets band 0 even though that band only fits, and a click on Method sets 2', () => {
        const { result } = setup();
        act(() => { result.current.zoomToBand(2); });
        expect(result.current.sequenceLod).toBe(2);
        act(() => { result.current.zoomToBand(0); });
        expect(result.current.sequenceLod).toBe(0);
    });
});

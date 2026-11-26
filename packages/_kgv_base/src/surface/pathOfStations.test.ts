import { describe, expect, it } from 'vitest';
import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { pathOfStations } from './path';
import { stationOfRef, type Station, type StationModel } from './stations';

const STATIONS = 6;
const stationName = (n: number): string => `st${n}`;

function modelOf(): Pick<StationModel, 'byId' | 'stationOf'> {
    const byId = new Map<string, Station>();
    const stationOf = new Map<string, string>();
    for (let s = 0; s < STATIONS; s++) {
        byId.set(stationName(s), { id: stationName(s), name: `Station ${s}`, ...(s % 2 ? { layer: 'domain' } : {}) } as Station);
        for (let f = 0; f < 3; f++) stationOf.set(`src:r::s${s}/f${f}.ts`, stationName(s));
    }
    return { byId, stationOf };
}

function edgesOf(): KEdge[] {
    let seed = 11;
    const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const ref = (): string => (next() < 0.1 ? 'src:r::elsewhere.ts' : `src:r::s${Math.floor(next() * STATIONS)}/f${Math.floor(next() * 3)}.ts${next() < 0.2 ? '#sym' : ''}`);
    return Array.from({ length: 600 }, () => ({ from: ref(), to: ref(), kind: next() < 0.8 ? 'references' : 'about', weight: 1, origin: 'extracted' }) as KEdge);
}

/** The definition this replaced: every edge is scanned for every hop. */
function naiveCounts(ids: string[], model: Pick<StationModel, 'stationOf'>, edges: readonly KEdge[]): number[] {
    return ids.slice(1).map((id, i) => edges.filter((e) => {
        if (e.kind !== 'references') return false;
        const from = stationOfRef(model, e.from), to = stationOfRef(model, e.to);
        return (from === ids[i] && to === id) || (from === id && to === ids[i]);
    }).length);
}

describe('pathOfStations', () => {
    it('counts each hop exactly as scanning every edge per hop does', () => {
        const model = modelOf(), edges = edgesOf();
        const refs = ['src:r::s3/f0.ts', 'src:r::s1/f2.ts#x', 'src:r::nowhere.ts', 'src:r::s3/f1.ts', 'src:r::s0/f0.ts', 'src:r::s5/f1.ts', 'src:r::s2/f2.ts'];
        const path = pathOfStations(refs, model, edges);
        const ids = path.stops.map((s) => s.id);
        expect(ids).toEqual(['st3', 'st1', 'st0', 'st5', 'st2']);
        expect(path.hops.map((h) => h.count)).toEqual(naiveCounts(ids, model, edges));
        expect(path.hops.some((h) => h.count > 0)).toBe(true);
        expect(path.stops[1]).toEqual({ id: 'st1', name: 'Station 1', layer: 'domain' });
        // The second call (the index is built once per edges array) answers the same.
        expect(pathOfStations(refs, model, edges)).toEqual(path);
    });

    it('answers a different station map over the same edges from that map, not the old index', () => {
        const edges = edgesOf();
        const a = modelOf();
        const b = { byId: a.byId, stationOf: new Map([...a.stationOf].map(([ref, id]) => [ref, id === 'st0' ? 'st1' : id] as const)) };
        const refs = ['src:r::s1/f0.ts', 'src:r::s2/f0.ts'];
        const idsB = pathOfStations(refs, b, edges).stops.map((s) => s.id);
        expect(pathOfStations(refs, a, edges).hops.map((h) => h.count)).toEqual(naiveCounts(pathOfStations(refs, a, edges).stops.map((s) => s.id), a, edges));
        expect(pathOfStations(refs, b, edges).hops.map((h) => h.count)).toEqual(naiveCounts(idsB, b, edges));
    });

    it('has no hops for fewer than two stations', () => {
        expect(pathOfStations(['src:r::s0/f0.ts', 'src:r::s0/f1.ts'], modelOf(), edgesOf()).hops).toEqual([]);
        expect(pathOfStations([], modelOf(), []).stops).toEqual([]);
    });
});

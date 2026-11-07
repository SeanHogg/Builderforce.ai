import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../testing';
import { buildLines, type Line, type LinesModel } from '../lines';
import { buildStations, type Station, type StationModel } from '../stations';
import { buildSystemLayout, kindTones, listRefs, MAX_LIST_REFS, MAX_PER_TIER } from './systemModel';

const station = (id: string, layer: string | undefined, use: number): Station => ({
    id, name: id, kind: 'area', entry: false, refs: [`ref:${id}`], files: 1, ...(layer ? { layer } : {}), anti: 1, findingIds: [], use,
    changed: false, patterns: [], dup: 0, unused: 0, facts: 0, claims: 0,
});
const modelOf = (stations: Station[]): StationModel => ({ stations, byId: new Map(stations.map((s) => [s.id, s] as const)), stationOf: new Map() });
const noLines: LinesModel = { lines: [], interchanges: new Map(), omitted: 0 };
const lineOf = (stops: string[], terminus: Line['terminus']): Line => ({ id: 'line:1', name: 'x', colourIndex: 0, stops, hops: [], terminus, stopReason: 'no-references' });

describe('buildSystemLayout', () => {
    it(`draws at most ${MAX_PER_TIER} cards per tier, busiest first, and counts the rest for the "+N more" card`, () => {
        const stations = Array.from({ length: 9 }, (_, i) => station(`d${i}`, 'domain', i / 10));
        const [tier] = buildSystemLayout(modelOf(stations), noLines, null).tiers;
        expect(tier!.layer).toBe('domain');
        expect(tier!.shown.map((s) => s.id)).toEqual(['d8', 'd7', 'd6', 'd5', 'd4', 'd3']);
        expect(tier!.hidden).toBe(3);
        expect(tier!.stations).toHaveLength(9);
    });

    it('has no "+N more" for a tier that fits', () => {
        const [tier] = buildSystemLayout(modelOf(Array.from({ length: MAX_PER_TIER }, (_, i) => station(`d${i}`, 'domain', 0.5))), noLines, null).tiers;
        expect(tier!.hidden).toBe(0);
    });

    it('never draws an "other" station that is on no line as a tile: it is only counted', () => {
        const stations = [station('a', 'domain', 1), station('o1', undefined, 0.5), station('o2', 'weird', 0.2)];
        const layout = buildSystemLayout(modelOf(stations), noLines, null);
        expect(layout.tiers.map((t) => t.layer)).toEqual(['domain']);
        expect(layout.notLayered.map((s) => s.id)).toEqual(['o1', 'o2']);
    });

    it('keeps an "other" station a line stops at as a card, and counts only the rest as not layered', () => {
        const stations = [station('a', 'domain', 1), station('o1', undefined, 0.5), station('o2', undefined, 0.2)];
        const layout = buildSystemLayout(modelOf(stations), { ...noLines, lines: [lineOf(['a', 'o1'], { kind: 'end', stationId: 'o1', provenance: 'heuristic' })] }, null);
        expect(layout.tiers.map((t) => t.layer)).toEqual(['domain', 'other']);
        expect(layout.tiers[1]!.shown.map((s) => s.id)).toEqual(['o1']);
        expect(layout.notLayered.map((s) => s.id)).toEqual(['o2']);
    });

    it('builds the store row from the termini the transit map draws: stores and services, once each, never a dead end', () => {
        const graph = surfaceFixture();
        const model = buildStations(graph);
        const layout = buildSystemLayout(model, buildLines(graph, model), graph);
        expect(layout.stores.map((t) => [t.kind, model.byId.get(t.stationId)!.name])).toEqual([['data', 'repositories']]);
        const ends = buildSystemLayout(model, { ...noLines, lines: [lineOf(['x'], { kind: 'end', stationId: 'x', provenance: 'heuristic' })] }, graph);
        expect(ends.stores).toEqual([]);
    });
});

describe('listRefs and kindTones', () => {
    it('hands the List the files of the stations, bounded', () => {
        const many = Array.from({ length: MAX_LIST_REFS + 10 }, (_, i) => ({ ...station(`s${i}`, 'domain', 0), refs: [`r${i}`] }));
        expect(listRefs(many)).toHaveLength(MAX_LIST_REFS);
        expect(listRefs([station('a', 'domain', 0)])).toEqual(['ref:a']);
    });

    it('gives each finding kind one colour by sorted order, the same for every caller', () => {
        const tones = kindTones(['b', 'a', 'b']);
        expect([...tones.keys()]).toEqual(['a', 'b']);
        expect(tones.get('a')).toBe('violation');
        expect(tones.get('b')).toBe('cycle');
    });
});

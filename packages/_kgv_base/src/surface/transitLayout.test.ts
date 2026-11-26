import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../testing';
import { buildLines } from './lines';
import { buildStations } from './stations';
import { BAND_HEIGHT, LABEL_SLOT, layoutTransit, MAX_ON_LINE_STATIONS, roundedPath } from './transitLayout';

const graph = surfaceFixture();
const model = buildStations(graph);
const lines = buildLines(graph, model);
const idOf = (name: string) => model.stations.find((s) => s.name === name)!.id;

describe('layoutTransit', () => {
    const layout = layoutTransit(model.stations, lines.lines, 900);

    it('stacks the layers that have stations, top to bottom', () => {
        expect(layout.bands.map((b) => b.layer)).toEqual(['entry', 'presentation', 'infrastructure']);
        expect(layout.height).toBeGreaterThanOrEqual(layout.bands.length * BAND_HEIGHT);
    });

    it('puts each station in the band of its layer, inside the width', () => {
        const entry = layout.positions.get(idOf('main.tsx'))!, repos = layout.positions.get(idOf('repositories'))!;
        expect(entry.y).toBeLessThan(repos.y);
        for (const p of layout.positions.values()) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(900); }
        expect(layout.drawn).toHaveLength(model.stations.length);
    });

    it('routes every hop of every line, with a path that ends at the station', () => {
        expect(layout.routes).toHaveLength(lines.lines.reduce((n, l) => n + l.hops.length, 0));
        for (const r of layout.routes) expect(r.d.startsWith('M ')).toBe(true);
    });

    it('is deterministic and has a minimum width', () => {
        expect(layoutTransit(model.stations, lines.lines, 900)).toEqual(layout);
        expect(layoutTransit(model.stations, lines.lines, 0).width).toBe(360);
    });

    it('keeps labels apart at 360px: 8 stations in one band make the map wider than the host and spacing stays at a label slot', () => {
        const eight = Array.from({ length: 8 }, (_, i) => ({ ...model.stations[0]!, id: `e${i}`, name: `station ${i}`, layer: 'domain', entry: false }));
        const wide = layoutTransit(eight, [], 360);
        expect(wide.width).toBeGreaterThanOrEqual(8 * LABEL_SLOT);
        const xs = [...wide.positions.values()].map((p) => p.x).sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(LABEL_SLOT - 1);
    });

    it('caps the stations drawn but always draws those on a line', () => {
        const many = Array.from({ length: 60 }, (_, i) => ({ ...model.stations[0]!, id: `x${i}`, name: `x${i}`, use: 0.1 }));
        const capped = layoutTransit([...model.stations, ...many], lines.lines, 900);
        expect(capped.drawn.length).toBeLessThanOrEqual(36);
        for (const l of lines.lines) for (const id of l.stops) expect(capped.drawn).toContain(id);
    });
});

describe('layoutTransit on tiny and huge input', () => {
    it('lays out no stations as one empty band row and a single station on its own band', () => {
        const none = layoutTransit([], [], 600);
        expect(none).toMatchObject({ bands: [], drawn: [], routes: [], hiddenOnLine: 0, height: 12 + BAND_HEIGHT });
        const one = layoutTransit([model.stations[0]!], [], 600);
        expect(one.drawn).toEqual([model.stations[0]!.id]);
        expect(one.bands).toHaveLength(1);
        expect(one.positions.size).toBe(1);
    });

    it('draws at most MAX_ON_LINE_STATIONS stations of lines and counts the rest', () => {
        const many = Array.from({ length: 400 }, (_, i) => ({ ...model.stations[0]!, id: `s${i}`, name: `s${i}`, layer: 'domain' }));
        const line = { ...lines.lines[0]!, id: 'big', stops: many.map((s) => s.id), hops: many.slice(1).map((s, i) => ({ from: many[i]!.id, to: s.id, count: 1 })) };
        const layout = layoutTransit(many, [line], 900);
        expect(layout.drawn).toHaveLength(MAX_ON_LINE_STATIONS);
        expect(layout.hiddenOnLine).toBe(400 - MAX_ON_LINE_STATIONS);
        expect(layout.routes).toHaveLength(MAX_ON_LINE_STATIONS - 1);
    });
});

describe('roundedPath', () => {
    it('rounds the corner with a quadratic and keeps straight runs', () => {
        expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }], 10)).toBe('M 0 0 L 0 90 Q 0 100 10 100 L 100 100');
        expect(roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }], 10)).toBe('M 0 0 L 50 0');
        expect(roundedPath([], 10)).toBe('');
    });
});

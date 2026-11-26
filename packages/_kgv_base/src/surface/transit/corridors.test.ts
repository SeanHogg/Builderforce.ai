import { describe, expect, it } from 'vitest';
import { freeColumn, LANE_GAP, routeLines } from './corridors';

const bands = [{ y: 0, h: 100 }, { y: 100, h: 100 }, { y: 200, h: 100 }];
const positions = new Map([
    ['a', { x: 50, y: 50 }], ['b', { x: 250, y: 150 }], ['c', { x: 150, y: 250 }], ['m', { x: 140, y: 150 }], ['a2', { x: 120, y: 50 }],
]);
const bandIndex = new Map([['a', 0], ['b', 1], ['c', 2], ['m', 1], ['a2', 0]]);

describe('routeLines', () => {
    it('runs a one-band hop along the corridor in the gap below the upper station', () => {
        const [r] = routeLines({ lines: [{ id: 'L', hops: [{ from: 'a', to: 'b' }] }], positions, bands, bandIndex });
        expect(r!.pts).toEqual([{ x: 50, y: 50 }, { x: 50, y: 100 }, { x: 250, y: 100 }, { x: 250, y: 150 }]);
        expect(r!.d.startsWith('M 50 50')).toBe(true);
        expect(r!.d).toContain('Q');
    });

    it('spreads lines that share a gap over separate lanes', () => {
        const routes = routeLines({ lines: [{ id: 'L1', hops: [{ from: 'a', to: 'b' }] }, { id: 'L2', hops: [{ from: 'a2', to: 'b' }] }], positions, bands, bandIndex });
        const ys = routes.map((r) => r.pts[1]!.y);
        expect(Math.abs(ys[0]! - ys[1]!)).toBe(LANE_GAP);
    });

    it('crosses a band it skips in a column clear of that band\'s stations', () => {
        const [r] = routeLines({ lines: [{ id: 'L', hops: [{ from: 'a', to: 'c' }] }], positions, bands, bandIndex });
        const column = r!.pts[2]!.x;
        expect(Math.abs(column - 140)).toBeGreaterThanOrEqual(30);
        expect(r!.pts[r!.pts.length - 1]).toEqual({ x: 150, y: 250 });
    });

    it('detours below the row for a hop within one band that passes a station, and is deterministic', () => {
        const input = { lines: [{ id: 'L', hops: [{ from: 'a', to: 'a2' }] }], positions, bands, bandIndex };
        expect(routeLines(input)).toEqual(routeLines(input));
        expect(routeLines(input)[0]!.pts).toHaveLength(2);
    });

    it('skips a hop whose station is not drawn', () => {
        expect(routeLines({ lines: [{ id: 'L', hops: [{ from: 'a', to: 'zzz' }] }], positions, bands, bandIndex })).toEqual([]);
    });
});

describe('lines that share a pair of stations', () => {
    const two = (from: string, to: string) => routeLines({ lines: [{ id: 'L1', hops: [{ from, to }] }, { id: 'L2', hops: [{ from, to }] }], positions, bands, bandIndex });

    it('never overdraw on a corridor route: their legs at the stations are a lane apart', () => {
        const [r1, r2] = two('a', 'b');
        expect(r1!.pts[0]!.x - r2!.pts[0]!.x).not.toBe(0);
        expect(Math.abs(r1!.pts[0]!.x - r2!.pts[0]!.x)).toBe(LANE_GAP);
        expect(r1!.d).not.toBe(r2!.d);
    });

    it('never overdraw on a straight run in a column or in a row', () => {
        const column = new Map([['a', { x: 50, y: 50 }], ['b', { x: 50, y: 150 }]]);
        const [c1, c2] = routeLines({ lines: [{ id: 'L1', hops: [{ from: 'a', to: 'b' }] }, { id: 'L2', hops: [{ from: 'a', to: 'b' }] }], positions: column, bands, bandIndex: new Map([['a', 0], ['b', 1]]) });
        expect(c1!.pts).toHaveLength(2);
        expect(c1!.pts[0]!.x).not.toBe(c2!.pts[0]!.x);
        const [r1, r2] = two('a', 'a2');
        expect(r1!.pts).toHaveLength(2);
        expect(r1!.pts[0]!.y).not.toBe(r2!.pts[0]!.y);
    });

    it('keeps a lone line on the station centres', () => {
        const [r] = routeLines({ lines: [{ id: 'L', hops: [{ from: 'a', to: 'a2' }] }], positions, bands, bandIndex });
        expect(r!.pts).toEqual([{ x: 50, y: 50 }, { x: 120, y: 50 }]);
    });
});

describe('degenerate input', () => {
    it('routes nothing when no station has a band', () => {
        expect(routeLines({ lines: [{ id: 'L', hops: [{ from: 'a', to: 'b' }] }], positions, bands, bandIndex: new Map() })).toEqual([]);
        expect(routeLines({ lines: [], positions: new Map(), bands: [], bandIndex: new Map() })).toEqual([]);
    });
});

describe('freeColumn in a dense row', () => {
    it('with no gap wide enough between stations, goes round the end of the row, never onto a station', () => {
        const dense = [[0, 20, 40, 60, 80, 100]];
        const column = freeColumn(50, dense);
        expect(Math.min(...dense[0]!.map((x) => Math.abs(x - column)))).toBeGreaterThanOrEqual(30);
        expect(column < 0 || column > 100).toBe(true);
        expect(freeColumn(5, [])).toBe(5);
    });
});

describe('freeColumn', () => {
    it('keeps the wanted column when nothing is near it and moves off a station that is', () => {
        expect(freeColumn(100, [[400]])).toBe(100);
        expect(Math.abs(freeColumn(100, [[100, 300]]) - 100)).toBeGreaterThanOrEqual(30);
    });
});

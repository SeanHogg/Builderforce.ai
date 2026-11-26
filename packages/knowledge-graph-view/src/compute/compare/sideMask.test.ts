import { describe, expect, it } from 'vitest';
import type { A11yItem, LabelRun, LinkBatch, Placement } from '../../stage/types';
import { applySideMask } from './sideMask';

// Slots: 0 station `st:s`, 1 node a (present), 2 node new (absent Before), 3 node gone (absent After), 4 node orphan.
const keys = ['st:s', 'node:a', 'node:new', 'node:gone', 'node:orphan'];
const marks = { keys, parentStation: Int32Array.from([-1, 0, 0, 0, -1]), parentFolder: Int32Array.from([-1, -1, -1, -1, -1]) };

const label = (slot: number): LabelRun => ({ slot, text: keys[slot]!, offsetPx: [0, 0], font: 'mono', size: 1, weight: 400, anchor: 'middle', tone: 0, halo: { tone: 0, px: 0 }, priority: 1, scale: 'world' });
const proxy = (slot: number): A11yItem => ({ slot, label: keys[slot]! });

/** Float32Array values are not float64 literals: compare element by element to float32 precision. */
function expectClose(actual: ArrayLike<number>, expected: number[]): void {
    expect(actual.length).toBe(expected.length);
    expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 5));
}

function placement(): Placement {
    return {
        generation: 1, cacheKey: 'g|map|', anchor: 'station',
        position: Float32Array.from([0, 0, 0, 1, 0, 1, 5, 0, 5, 7, 0, 7, 9, 0, 9]),
        scale: Float32Array.from([1, 1, 1, 1, 1]), extrude: Float32Array.from([1, 1, 1, 1, 1]),
        links: [], planes: [], labels: keys.map((_, i) => label(i)), captions: [], a11y: keys.map((_, i) => proxy(i)),
        caption: { shown: 5, total: 5, capped: false }, bounds: { min: [0, 0, 0], max: [9, 0, 9] },
        rig: { projection: 'orthographic', frame: 'fill', home: { position: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0] }, depth: { tilt: [0, 0], orbit: false } },
    };
}

describe('applySideMask', () => {
    it('shrinks an absent slot to scale 0 on its parent station and leaves a present one unchanged', () => {
        const base = placement();
        const out = applySideMask(base, marks, new Set(['new']), new Map());
        expect(out.scale[2]).toBe(0);
        expect(out.extrude[2]).toBe(0);
        expect([...out.position.slice(6, 9)]).toEqual([0, 0, 0]); // the station's position
        expect([...out.scale].filter((s, i) => i !== 2)).toEqual([1, 1, 1, 1]);
        expect([...out.position.slice(0, 6)]).toEqual([0, 0, 0, 1, 0, 1]);
        expect([...out.position.slice(9)]).toEqual([...base.position.slice(9)]);
        expect(base.scale[2]).toBe(1); // the input is never written
    });

    it('anchors an absent slot at the mark it was born from when that mark is present', () => {
        const out = applySideMask(placement(), marks, new Set(['new']), new Map([['new', 'a']]));
        expect([...out.position.slice(6, 9)]).toEqual([1, 0, 1]);
    });

    it('falls back to the parent when the born-from mark is itself absent, and keeps an orphan where it was', () => {
        const out = applySideMask(placement(), marks, new Set(['new', 'orphan']), new Map([['new', 'orphan']]));
        expect([...out.position.slice(6, 9)]).toEqual([0, 0, 0]);
        expect([...out.position.slice(12, 15)]).toEqual([9, 0, 9]);
        expect(out.scale[4]).toBe(0);
    });

    it('drops the captions and a11y proxies of absent slots only', () => {
        const out = applySideMask(placement(), marks, new Set(['gone']), new Map());
        expect(out.labels.map((l) => l.slot)).toEqual([0, 1, 2, 4]);
        expect(out.a11y.map((a) => a.slot)).toEqual([0, 1, 2, 4]);
    });

    it('collapses a link end standing on an absent mark onto its anchor, and leaves other links as they were', () => {
        const batch = (pts: number[]): LinkBatch => ({ family: 'edge', points: Float32Array.from(pts), runLength: new Float32Array(0), tone: new Uint8Array(0), width: new Float32Array(0), dash: new Uint8Array(0), flags: new Uint8Array(0), group: new Uint32Array(0), widthUnit: 'world' });
        const toNew = batch([1, 0, 1, 3, 0, 3, 5, 0, 5]); // a -> (a bend) -> new
        const kept = batch([1, 0, 1, 9, 0, 9]); // a -> orphan (present)
        const base = { ...placement(), links: [toNew, kept] };
        const out = applySideMask(base, marks, new Set(['new']), new Map());
        expect([...out.links[0]!.points]).toEqual([1, 0, 1, 3, 0, 3, 0, 0, 0]); // the end moved to the station's spot; the bend stays
        expect(out.links[1]).toBe(kept);
        expect([...toNew.points.slice(6)]).toEqual([5, 0, 5]); // the input is never written
    });

    it('keeps a link whose end shares its spot with a shown mark', () => {
        const batch: LinkBatch = { family: 'edge', points: Float32Array.from([1, 0, 1, 5, 0, 5]), runLength: new Float32Array(0), tone: new Uint8Array(0), width: new Float32Array(0), dash: new Uint8Array(0), flags: new Uint8Array(0), group: new Uint32Array(0), widthUnit: 'world' };
        const base = placement();
        base.position[12] = 5; base.position[14] = 5; // `orphan` (shown) stands where `new` does
        const out = applySideMask({ ...base, links: [batch] }, marks, new Set(['new']), new Map());
        expect(out.links[0]).toBe(batch);
    });

    describe('link collapsing by footprint', () => {
        const batch = (pts: number[], over: Partial<LinkBatch> = {}): LinkBatch => ({ family: 'edge', points: Float32Array.from(pts), runLength: new Float32Array(0), tone: new Uint8Array(0), width: new Float32Array(0), dash: new Uint8Array(0), flags: new Uint8Array(0), group: new Uint32Array(0), widthUnit: 'world', ...over });

        it('moves a parallel route end offset from the centre but inside the absent mark\'s footprint', () => {
            const base = placement();
            base.scale[2] = 2; // `new` at (5,5) with radius 2
            const route = batch([1, 0, 1, 6.2, 0, 4.4]);
            const out = applySideMask({ ...base, links: [route] }, marks, new Set(['new']), new Map());
            expect([...out.links[0]!.points]).toEqual([1, 0, 1, 0, 0, 0]);
            expectClose(route.points.slice(3), [6.2, 0, 4.4]); // Float32 storage: 6.2 reads back as 6.199999809…
        });

        it('moves an interior point of a route passing through an absent station, but not through an absent node', () => {
            const stationMarks = { keys: ['st:a', 'st:gone', 'node:x'], parentStation: Int32Array.from([-1, -1, -1]), parentFolder: Int32Array.from([-1, -1, -1]) };
            const base = { ...placement(), position: Float32Array.from([0, 0, 0, 5, 0, 5, 9, 0, 9]), scale: Float32Array.from([1, 1, 1]), extrude: Float32Array.from([1, 1, 1]), labels: [], a11y: [] };
            const route = batch([0, 0, 0, 5, 0, 5, 9, 0, 9]);
            // the station is absent with no anchor of its own: it stays where it was, so nothing moves
            expect(applySideMask({ ...base, links: [route] }, stationMarks, new Set(['st:gone']), new Map()).links[0]).toBe(route);
            const anchored = { ...stationMarks, parentFolder: Int32Array.from([-1, 0, -1]) };
            const out = applySideMask({ ...base, links: [route] }, anchored, new Set(['st:gone']), new Map());
            expect([...out.links[0]!.points]).toEqual([0, 0, 0, 0, 0, 0, 9, 0, 9]);
            // an absent NODE only moves a route's ends: a route passing through its spot keeps going
            const through = batch([0, 0, 0, 9, 0, 9, 3, 0, 3]);
            const viaNode = applySideMask({ ...base, links: [through] }, { ...anchored, parentStation: Int32Array.from([-1, -1, 0]) }, new Set(['x']), new Map());
            expect(viaNode.links[0]).toBe(through);
        });

        it('walks past an absent anchor to the nearest shown ancestor', () => {
            // new -> (born from) orphan (absent) -> its station (slot 0, shown)
            const walked = { ...marks, parentStation: Int32Array.from([-1, 0, 0, 0, 0]) };
            const out = applySideMask(placement(), walked, new Set(['new', 'orphan']), new Map([['new', 'orphan']]));
            expect([...out.position.slice(6, 9)]).toEqual([0, 0, 0]);
            expect([...out.position.slice(12, 15)]).toEqual([0, 0, 0]);
        });

        it('hides a Sequence absent participant\'s lifeline and the messages ending on its column, keeping the others', () => {
            const base = placement();
            base.position.set([20, 0, 10], 6); // `new`'s head at (20, 0, 10); scale 1
            base.position.set([0, 0, 10], 0);
            const lifeline = batch([20, 0, 11, 20, 0, 100]);
            const other = batch([0, 0, 11, 0, 0, 100]);
            const message = batch([0, 0, 40, 20, 0, 40], { family: 'arrow' });
            const unrelated = batch([0, 0, 50, 1, 0, 50], { family: 'arrow' });
            const out = applySideMask({ ...base, links: [lifeline, other, message, unrelated] }, marks, new Set(['new']), new Map());
            expect([...out.links[0]!.points]).toEqual([20, 0, 11, 20, 0, 11]);
            expect(out.links[1]).toBe(other);
            expect([...out.links[2]!.points]).toEqual([0, 0, 40, 0, 0, 40]);
            expect(out.links[3]).toBe(unrelated);
        });

        it('does not treat a mark the placement already parked at scale 0 as a link source, and recomputes runLength for a moved end', () => {
            const parkedAt0 = placement();
            parkedAt0.scale[2] = 0;
            const link = batch([1, 0, 1, 5, 0, 5]);
            expect(applySideMask({ ...parkedAt0, links: [link] }, marks, new Set(['new']), new Map()).links[0]).toBe(link);

            const run = batch([1, 0, 1, 5, 0, 5], { runLength: Float32Array.from([0, Math.hypot(4, 4)]) });
            const out = applySideMask({ ...placement(), links: [run] }, marks, new Set(['new']), new Map());
            expect([...out.links[0]!.runLength]).toEqual([0, Math.fround(Math.hypot(1, 1))]);
        });
    });

    it('returns the same placement when nothing is absent or no absent ref is a slot', () => {
        const base = placement();
        expect(applySideMask(base, marks, new Set(), new Map())).toBe(base);
        expect(applySideMask(base, marks, new Set(['nowhere']), new Map())).toBe(base);
    });
});

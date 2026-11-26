import { describe, expect, it } from 'vitest';
import type { A11yItem, LabelRun, Placement } from '../../stage/types';
import { applySideMask } from './sideMask';

// Slots: 0 station `st:s`, 1 node a (present), 2 node new (absent Before), 3 node gone (absent After), 4 node orphan.
const keys = ['st:s', 'node:a', 'node:new', 'node:gone', 'node:orphan'];
const marks = { keys, parentStation: Int32Array.from([-1, 0, 0, 0, -1]), parentFolder: Int32Array.from([-1, -1, -1, -1, -1]) };

const label = (slot: number): LabelRun => ({ slot, text: keys[slot]!, offsetPx: [0, 0], font: 'mono', size: 1, weight: 400, anchor: 'middle', tone: 0, halo: { tone: 0, px: 0 }, priority: 1, scale: 'world' });
const proxy = (slot: number): A11yItem => ({ slot, label: keys[slot]! });

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

    it('returns the same placement when nothing is absent or no absent ref is a slot', () => {
        const base = placement();
        expect(applySideMask(base, marks, new Set(), new Map())).toBe(base);
        expect(applySideMask(base, marks, new Set(['nowhere']), new Map())).toBe(base);
    });
});

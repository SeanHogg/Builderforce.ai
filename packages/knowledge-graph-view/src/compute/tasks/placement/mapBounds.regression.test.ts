/**
 * Regression: Map / Sequence document frames clipped route casing and decorations because bounds were the station box.
 */
import { describe, expect, it } from 'vitest';
import type { LinkBatch } from '../../../stage/types';
import { widenMapBounds } from './mapBounds';

const batch = (xyz: number[], width: number): LinkBatch => ({
    family: 'wall',
    points: new Float32Array(xyz),
    runLength: new Float32Array(xyz.length / 3),
    tone: new Uint8Array(1),
    width: new Float32Array([width]),
    dash: new Uint8Array(1),
    flags: new Uint8Array(1),
    group: new Uint32Array(1),
    widthUnit: 'world',
});

describe('map bounds', () => {
    it('regression: route casing and decoration extents widen the station box (clipped lines on Map)', () => {
        const layout = {
            width: 400,
            height: 200,
            routes: [{ lineId: 'l', pts: [{ x: -12, y: 40 }, { x: 420, y: 40 }] }],
        };
        const bounds = widenMapBounds(layout, new Map([['l', 6]]), 2, 4, 0, [batch([-30, 0, 10, NaN, NaN, NaN], 5)]);
        // Casing pad is (6 + 4) / 2 = 5, so the route at x=-12 reaches -17 and x=420 reaches 425.
        expect(bounds.min[0]).toBeLessThanOrEqual(-17);
        expect(bounds.max[0]).toBeGreaterThanOrEqual(425);
        // The wall point at x=-30, width 5, reaches -32.5 — outside the station box.
        expect(bounds.min[0]).toBeLessThanOrEqual(-32.5);
        expect(bounds.min[2]).toBeLessThanOrEqual(0);
        expect(bounds.max[2]).toBeGreaterThanOrEqual(200);
        // Without the widen, a document frame fitted to [0,400] x [0,200] would clip both.
        expect(bounds.min[0]).toBeLessThan(0);
        expect(bounds.max[0]).toBeGreaterThan(layout.width);
    });
});

/**
 * PRD 43 P1a revision 2: every pair of the 13 type silhouettes must stay apart at 8 px (DPR 1). The metric is the
 * P1a measurement's — XOR / union of the thresholded silhouettes, < 0.10 counted indistinguishable — computed here
 * over the registry's outline polygons with a tiny software rasterizer (no canvas), at four sub-pixel phases so a mark
 * that lands between pixels counts too.
 */

import { describe, expect, it } from 'vitest';
import { MARK_TYPE_ORDER, NODE_SHAPES, SHAPE_EXTENT, SHAPE_OUTLINES, TYPE_SHAPE, type NodeShape } from './shapes';

type Poly = readonly (readonly [number, number])[];

function inside(poly: Poly, x: number, y: number): boolean {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
}

const CELL = 24, SUB = 4;

/** The silhouette at `diameter` CSS px (unit radius = diameter / 2), thresholded at half coverage (4×4 samples a pixel). */
function raster(poly: Poly, diameter: number, dpr: number, ox: number, oy: number): Uint8Array {
    const r = (diameter / 2) * dpr, c = CELL * dpr, cx = c / 2 + ox, cy = c / 2 + oy, out = new Uint8Array(c * c);
    for (let py = 0; py < c; py++) for (let px = 0; px < c; px++) {
        let hit = 0;
        for (let sy = 0; sy < SUB; sy++) for (let sx = 0; sx < SUB; sx++) {
            if (inside(poly, (px + (sx + 0.5) / SUB - cx) / r, (py + (sy + 0.5) / SUB - cy) / r)) hit++;
        }
        out[py * c + px] = hit * 2 > SUB * SUB ? 1 : 0;
    }
    return out;
}

function xorOverUnion(a: Uint8Array, b: Uint8Array): number {
    let x = 0, u = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) x++; if (a[i] || b[i]) u++; }
    return u ? x / u : 0;
}

const PHASES = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]] as const;

/** Each pair's worst case over the sub-pixel phases, smallest first. */
function pairwise(diameter: number, dpr: number): { pair: string; d: number }[] {
    const shapes = MARK_TYPE_ORDER.map((t) => TYPE_SHAPE[t]);
    const rasters = PHASES.map(([ox, oy]) => shapes.map((s) => raster(SHAPE_OUTLINES[s], diameter, dpr, ox, oy)));
    const out: { pair: string; d: number }[] = [];
    for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
        const d = Math.min(...rasters.map((r) => xorOverUnion(r[i]!, r[j]!)));
        out.push({ pair: `${MARK_TYPE_ORDER[i]}/${MARK_TYPE_ORDER[j]}`, d });
    }
    return out.sort((a, b) => a.d - b.d);
}

describe('shape distinguishability (PRD 43 P1a revision 2)', () => {
    it('regression: every pair of the 13 types differs by XOR/union ≥ 0.15 at 8 px, DPR 1 (was < 0.10 for square/rounded square, triangle/rounded triangle, circle/hexagon, drum/square)', () => {
        const pairs = pairwise(8, 1);
        expect(pairs).toHaveLength((13 * 12) / 2);
        // Measured 2026-11-10: worst pair test/entity 0.154.
        expect(pairs[0]!.d, pairs.slice(0, 3).map((p) => `${p.pair}=${p.d.toFixed(3)}`).join(' ')).toBeGreaterThanOrEqual(0.15);
    });

    it('stays apart at 12 px DPR 1 and 8 px DPR 2 too', () => {
        // Below 8 px tone stays the primary cue (B1a rule 2), so 6 px is not asserted.
        for (const [px, dpr] of [[12, 1], [8, 2]] as const) {
            const worst = pairwise(px, dpr)[0]!;
            expect(worst.d, `${px}px@${dpr} ${worst.pair}`).toBeGreaterThanOrEqual(0.15);
        }
    });

    it('keeps every outline inside ±SHAPE_EXTENT on each axis (the stage cap quad, the legend viewBox)', () => {
        for (const s of NODE_SHAPES as NodeShape[]) {
            for (const [x, y] of SHAPE_OUTLINES[s]) {
                expect(Math.abs(x), s).toBeLessThanOrEqual(SHAPE_EXTENT + 1e-9);
                expect(Math.abs(y), s).toBeLessThanOrEqual(SHAPE_EXTENT + 1e-9);
            }
        }
    });
});

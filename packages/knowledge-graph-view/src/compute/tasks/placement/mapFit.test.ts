import { describe, expect, it } from 'vitest';
import { MIN_FIT_EXTENT, mapFit } from './mapFit';

const plate = { width: 960, height: 132 };
const full = mapFit(plate, [{ x: 0, y: 0 }, { x: 960, y: 132 }], 0);

describe('map fit', () => {
    it('regression: one drawn stop on a 960-wide plate is framed at a sane extent, not the whole empty plate', () => {
        const one = mapFit(plate, [{ x: 480, y: 66 }], 20);
        expect(one.radius).toBeLessThan(full.radius / 2);
        expect(one.radius).toBeGreaterThanOrEqual(MIN_FIT_EXTENT / 2);
        expect(one.cx).toBeCloseTo(480);
    });

    it('degenerate input (no points, NaN or Infinity points, a stop on the plate corner) stays finite, inside the plate and above the floor', () => {
        for (const pts of [[], [{ x: NaN, y: NaN }], [{ x: Infinity, y: 5 }], [{ x: 5, y: -Infinity }], [{ x: 0, y: 0 }], [{ x: 960, y: 132 }]]) {
            const fit = mapFit(plate, pts, 0);
            expect(Number.isFinite(fit.radius) && fit.radius >= MIN_FIT_EXTENT / 2).toBe(true);
            expect(fit.cx).toBeGreaterThanOrEqual(0);
            expect(fit.cx).toBeLessThanOrEqual(plate.width);
            expect(fit.cz).toBeGreaterThanOrEqual(0);
            expect(fit.cz).toBeLessThanOrEqual(plate.height);
        }
    });

    it('a level that fills the plate keeps framing the whole plate', () => {
        expect(full.cx).toBeCloseTo(480);
        expect(full.radius).toBeCloseTo(Math.hypot(960, 132) / 2 + 12);
    });
});

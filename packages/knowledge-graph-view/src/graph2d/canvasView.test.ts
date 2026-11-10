import { describe, expect, it } from 'vitest';
import { canvasMapping } from './drawNodes';
import { applyTransform, layoutToCanvas, visibleRect } from './canvasView';
import { fitView, layout2d } from './layout2d';
import { partitionedFixture } from './testFixtures';

/** Where the SVG (`xMidYMid meet`) draws a layout point, in CSS pixels — the overlay's transform. */
function svgPx(view: { x: number; y: number; w: number; h: number }, width: number, height: number, x: number, y: number): [number, number] {
    const m = canvasMapping(view, width, height)!;
    return [(x - view.x) * m.scale + m.ox, (y - view.y) * m.scale + m.oy];
}

describe('the node canvas and the SVG overlay share ONE transform', () => {
    const f = partitionedFixture();
    const l = layout2d('mono', f.nodes, f.edges);

    for (const [width, height, dpr] of [[1200, 700, 1], [1200, 700, 2], [500, 900, 1.5]] as const) {
        it(`puts every node on the pixel the SVG puts it (${width}x${height} @${dpr}x)`, () => {
            const view = fitView(l, width, height);
            const rect = visibleRect(view, width, height)!;
            const t = layoutToCanvas(rect, width * dpr, height * dpr);
            for (const [x, y] of l.positions.values()) {
                const [cx, cy] = applyTransform(t, x, y);
                const [sx, sy] = svgPx(view, width, height, x, y);
                expect(cx / dpr).toBeCloseTo(sx, 6);
                expect(cy / dpr).toBeCloseTo(sy, 6);
            }
        });
    }

    it('agrees on a view the person panned and zoomed, letterboxed after a resize', () => {
        const view = { x: 13.5, y: -40, w: 30, h: 30 }; // square view in a wide area: letterboxed left and right
        const rect = visibleRect(view, 900, 300)!;
        expect(rect.h).toBeCloseTo(30, 9);
        expect(rect.w).toBeCloseTo(90, 9);
        const t = layoutToCanvas(rect, 900, 300);
        for (const [x, y] of [[13.5, -40], [43.5, -10], [28, -25]] as const) {
            const [cx, cy] = applyTransform(t, x, y);
            const [sx, sy] = svgPx(view, 900, 300, x, y);
            expect(cx).toBeCloseTo(sx, 9);
            expect(cy).toBeCloseTo(sy, 9);
        }
    });

    it('regression: the view origin is applied, so nodes land inside their bands, not slid to the canvas\'s top-left', () => {
        const view = fitView(l, 1200, 700);
        const rect = visibleRect(view, 1200, 700)!;
        const t = layoutToCanvas(rect, 1200, 700);
        // The view's top-left corner is the canvas's (0, 0) — before the fix it was layout (0, 0) instead.
        const [ox, oy] = applyTransform(t, rect.x, rect.y);
        expect(ox).toBeCloseTo(0, 9);
        expect(oy).toBeCloseTo(0, 9);
        for (const n of f.nodes) {
            const [x, y] = l.positions.get(n.ref)!;
            const band = l.bands.find((b) => b.partition === (n.partition ?? ''))!;
            const [, top] = applyTransform(t, l.bounds.minX, band.top);
            const [, bottom] = applyTransform(t, l.bounds.minX, band.top + band.height);
            const [left] = applyTransform(t, l.bounds.minX, 0);
            const [right] = applyTransform(t, l.bounds.maxX, 0);
            const [cx, cy] = applyTransform(t, x, y);
            expect(cx).toBeGreaterThanOrEqual(Math.max(0, left));
            expect(cx).toBeLessThanOrEqual(Math.min(1200, right));
            expect(cy).toBeGreaterThanOrEqual(Math.max(0, top));
            expect(cy).toBeLessThanOrEqual(Math.min(700, bottom));
        }
    });

    it('has no rect before the area is measured', () => {
        expect(visibleRect({ x: 0, y: 0, w: 10, h: 10 }, 0, 0)).toBeNull();
    });
});

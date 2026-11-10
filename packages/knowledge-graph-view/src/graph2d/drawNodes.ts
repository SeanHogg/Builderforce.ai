/**
 * The 2D node layer's drawing core. One `<canvas>` draws every node mark instead of one
 * `<g>` per node: marks are bucketed by SHAPE (mirroring the WebGL scene's `Cylinders`
 * bucketing — one Path2D and one style setup per shape kind), culled against the current
 * viewBox, and painted in batches across requestAnimationFrame frames so a 15k-node graph
 * shows its first marks immediately. Pure and DOM-free where possible: the rAF loop in
 * NodeCanvas composes the transforms and calls {@link drawMark}; everything here is
 * testable without a real canvas.
 */

import type { NodeShape } from '../lenses';
import type { ThemeColors } from '../scene/themeColors';
import type { ViewBox } from '../usePanZoom';

/** Everything the canvas needs to draw one node — resolved from the lens and layout, in IMPORTANCE order. */
export interface NodeMark {
    id: string;
    x: number;
    y: number;
    /** Resolved through the theme-token system (`readThemeColors`), never a hardcoded hex. */
    tone: keyof ThemeColors;
    dim: boolean;
    /** Layout units — `Math.max(nodeRadius(importance), 3 * perPx)`, same as the old SVG dot. */
    r: number;
    shape: NodeShape;
}

export interface ShapeBucket {
    shape: NodeShape;
    marks: NodeMark[];
}

/** Marks painted per animation frame while the incremental pass catches up (a few hundred, per frame). */
export const DRAW_BATCH = 400;

/** Group marks by shape, each bucket keeping importance order — one Path2D per kind, as the WebGL scene does. */
export function bucketByShape(marks: readonly NodeMark[]): ShapeBucket[] {
    const by = new Map<NodeShape, NodeMark[]>();
    for (const m of marks) {
        const list = by.get(m.shape);
        if (list) list.push(m);
        else by.set(m.shape, [m]);
    }
    return [...by].map(([shape, list]) => ({ shape, marks: list }));
}

export interface PaintQueue {
    /** Hands up to `limit` marks to `draw`, bucket by bucket in order; true once every mark has been handed out. */
    next(limit: number, draw: (mark: NodeMark, shape: NodeShape) => void): boolean;
}

/**
 * The incremental pass's cursor over the buckets: an index per pass, never `shift()` (O(n) per
 * mark over up to ~15k marks per frame). The buckets are read, not mutated.
 */
export function paintQueue(buckets: readonly ShapeBucket[]): PaintQueue {
    let b = 0;
    let i = 0;
    return {
        next(limit, draw) {
            let drawn = 0;
            while (b < buckets.length && drawn < limit) {
                const bucket = buckets[b]!;
                if (i >= bucket.marks.length) { b++; i = 0; continue; }
                draw(bucket.marks[i++]!, bucket.shape);
                drawn++;
            }
            while (b < buckets.length && i >= buckets[b]!.marks.length) { b++; i = 0; }
            return b >= buckets.length;
        },
    };
}

/** A mark draws only when its (radius-padded) bounds intersect the viewBox. */
export function markVisible(m: NodeMark, view: ViewBox): boolean {
    return m.x + m.r >= view.x && m.x - m.r <= view.x + view.w && m.y + m.r >= view.y && m.y - m.r <= view.y + view.h;
}

/** viewBox → CSS-pixel mapping, the same `xMidYMid meet` fit the SVG uses, so the canvas overlays it exactly. */
export interface CanvasMapping {
    /** CSS pixels per viewBox unit. */
    scale: number;
    /** Letterbox offsets: the viewBox is centred in a wider/taller box. */
    ox: number;
    oy: number;
}

export function canvasMapping(view: ViewBox, width: number, height: number): CanvasMapping | null {
    if (width <= 0 || height <= 0 || view.w <= 0 || view.h <= 0) return null;
    const scale = Math.min(width / view.w, height / view.h);
    return { scale, ox: (width - view.w * scale) / 2, oy: (height - view.h * scale) / 2 };
}

/**
 * One node's mark: translate to it, scale to its radius, fill the shape path in its tone
 * with a thin background-colour stroke — exactly the look of the old `<path d={SHAPE_PATHS[shape]}>`.
 * Called with the base viewBox→device transform already set; save/restore keeps it intact.
 */
export function drawMark(ctx: CanvasRenderingContext2D, mark: NodeMark, path: Path2D, colors: ThemeColors, bg: string): void {
    ctx.save();
    ctx.translate(mark.x, mark.y);
    ctx.scale(mark.r, mark.r);
    ctx.globalAlpha = mark.dim ? 0.35 : 1;
    ctx.fillStyle = colors[mark.tone];
    ctx.strokeStyle = bg;
    ctx.lineWidth = 0.1; // node-local units (radius 1), matching the old strokeWidth on the scaled path
    ctx.fill(path);
    ctx.stroke(path);
    ctx.restore();
}

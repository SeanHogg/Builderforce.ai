/**
 * The ONE mapping from the 2D graph's layout units to the node canvas's pixels. The canvas lives inside the SVG (a
 * `<foreignObject>` over the region the SVG shows), so it shares the SVG's transform: the canvas only has to map that
 * region onto its own backing store. Pure, so the "canvas and SVG agree" contract is testable without a canvas.
 */

import type { ViewBox } from '../usePanZoom';
import { canvasMapping } from './drawNodes';

/**
 * The layout-unit rectangle a `width` × `height` SVG actually shows for `view`: the viewBox plus the letterbox that
 * `preserveAspectRatio="xMidYMid meet"` adds on the longer side. Null before the area is measured.
 */
export function visibleRect(view: ViewBox, width: number, height: number): ViewBox | null {
    const m = canvasMapping(view, width, height);
    if (!m) return null;
    return { x: view.x - m.ox / m.scale, y: view.y - m.oy / m.scale, w: width / m.scale, h: height / m.scale };
}

/** A 2D-context transform, as `setTransform(a, b, c, d, e, f)` takes it. */
export type CanvasTransform = readonly [number, number, number, number, number, number];

/**
 * The transform that draws layout point (x, y) on a canvas whose box covers `rect` with a `pxW` × `pxH` backing store:
 * translate by the rect's ORIGIN first, then scale. (Leaving the origin out draws every node as if the view started at
 * (0, 0) — the whole graph slides left and up, off its bands.)
 */
export function layoutToCanvas(rect: ViewBox, pxW: number, pxH: number): CanvasTransform {
    const sx = pxW / rect.w, sy = pxH / rect.h;
    return [sx, 0, 0, sy, -rect.x * sx, -rect.y * sy];
}

/** Applies a {@link CanvasTransform} to a point — what the canvas does to every mark centre. */
export function applyTransform(t: CanvasTransform, x: number, y: number): readonly [number, number] {
    return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

/**
 * The stage's ONE orthographic projection math (PRD 43 B2/B5): how a placement is fitted into the stage box and how a
 * world point lands on screen under the rig's view (centre, zoom, tilt about the x axis; screen up = world −z). The rig
 * (`rig/rig.ts`: project, projector, pose) and the projector module (`projector.ts`: frameOf, frameProjector, toScreen)
 * both read it, so picking, the a11y proxies, the caption layer and the camera can never disagree. Pure, allocation-free
 * on the hot path (callers pass `out`).
 */

/** Space kept round a fitted placement, CSS px. */
export const FIT_MARGIN = 16;

/** The rig's view: ground point at the centre, CSS px per world unit, tilt in degrees, and the box it draws into. */
export interface GroundView { cx: number; cz: number; zoom: number; tilt: number; width: number; height: number }

export interface Bounds { min: readonly [number, number, number]; max: readonly [number, number, number] }

/** The centre and zoom that fit `bounds` into a `width` × `height` box with {@link FIT_MARGIN}. */
export function fitView(bounds: Bounds, width: number, height: number): { cx: number; cz: number; zoom: number } {
    const { min, max } = bounds;
    const w = Math.max(1, max[0] - min[0]), h = Math.max(1, max[2] - min[2]);
    const zoom = Math.max(1e-3, Math.min((width - 2 * FIT_MARGIN) / w, (height - 2 * FIT_MARGIN) / h));
    return { cx: (min[0] + max[0]) / 2, cz: (min[2] + max[2]) / 2, zoom };
}

/** The height of a `document` frame: `bounds` fitted to `width` (the page scrolls past it, B2). */
export function documentHeight(bounds: Bounds, width: number): number {
    const w = Math.max(1, bounds.max[0] - bounds.min[0]), d = Math.max(1, bounds.max[2] - bounds.min[2]);
    return Math.ceil(d * ((width - 2 * FIT_MARGIN) / w) + 2 * FIT_MARGIN);
}

/** World (x, y, z) → CSS px in the box, written to `out[0]`, `out[1]`. */
export function projectGround(v: GroundView, x: number, y: number, z: number, out: { 0: number; 1: number }): void {
    const a = (v.tilt * Math.PI) / 180;
    out[0] = (x - v.cx) * v.zoom + v.width / 2;
    out[1] = ((z - v.cz) * Math.cos(a) - y * Math.sin(a)) * v.zoom + v.height / 2;
}

/** The same map as a column-major 4×4 into screen px (row 3 = (0, 0, 0, 1): orthographic). */
export function groundScreenMatrix(v: GroundView, out: Float64Array = new Float64Array(16)): Float64Array {
    const a = (v.tilt * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), k = v.zoom;
    out.fill(0);
    out[0] = k;                                   // x → sx
    out[5] = -sin * k;                            // y → sy
    out[9] = cos * k;                             // z → sy
    out[12] = v.width / 2 - v.cx * k;
    out[13] = v.height / 2 - v.cz * cos * k;
    out[15] = 1;
    return out;
}

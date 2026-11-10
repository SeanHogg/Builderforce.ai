/**
 * World → screen for the stage (PRD 43 B5): the fitted top-down frame, a three.js camera's matrices, and the rig's own
 * projection all as ONE {@link Projector}. Picking reads a projector as a 4×4 screen matrix ({@link screenMatrixOf}) so
 * a settle projects every slot in one tight loop with the matrix inlined — no call per point, no allocation.
 * Pure, no DOM, no three.
 */

import type { Placement } from './types';

/** The orthographic top-down frame the stage fits a placement into. */
export interface ScreenFrame { zoom: number; cx: number; cz: number; width: number; height: number }

const FIT_MARGIN = 16;

/** The frame that fits `p`'s bounds into a `width` × `height` box (world x → screen x, world z → screen y). */
export function frameOf(p: Pick<Placement, 'bounds'>, width: number, height: number): ScreenFrame {
    const { min, max } = p.bounds;
    const w = Math.max(1, max[0] - min[0]), h = Math.max(1, max[2] - min[2]);
    const zoom = Math.max(1e-3, Math.min((width - 2 * FIT_MARGIN) / w, (height - 2 * FIT_MARGIN) / h));
    return { zoom, cx: (min[0] + max[0]) / 2, cz: (min[2] + max[2]) / 2, width, height };
}

export function toScreen(f: ScreenFrame, x: number, z: number): [number, number] {
    return [(x - f.cx) * f.zoom + f.width / 2, (z - f.cz) * f.zoom + f.height / 2];
}

/** World → screen pixels for the current camera. `project` writes x, y into `out`; false = behind the camera. */
export interface Projector {
    readonly width: number;
    readonly height: number;
    /** Changes whenever the projection does (settling compares it). */
    readonly key: string;
    /** Screen pixels per world unit at the target (cards and rings size marks with it). */
    readonly pxPerWorld: number;
    project(x: number, y: number, z: number, out: Float64Array): boolean;
    /**
     * The same projection as a column-major 4×4 into screen pixels (sx = row0·p / row3·p, sy = row1·p / row3·p), when the
     * projector knows it. Absent ⇒ {@link screenMatrixOf} derives it from `project` for an affine (orthographic) one.
     */
    readonly screen?: Float64Array;
}

export function frameProjector(f: ScreenFrame): Projector {
    const hw = f.width / 2, hh = f.height / 2;
    const screen = Float64Array.from([f.zoom, 0, 0, 0, 0, 0, 0, 0, 0, f.zoom, 0, 0, hw - f.cx * f.zoom, hh - f.cz * f.zoom, 0, 1]);
    return {
        width: f.width, height: f.height, pxPerWorld: f.zoom, key: `f|${f.zoom}|${f.cx}|${f.cz}|${f.width}|${f.height}`, screen,
        project(x, _y, z, out) { out[0] = (x - f.cx) * f.zoom + hw; out[1] = (z - f.cz) * f.zoom + hh; return true; },
    };
}

/** A three.js camera's (column-major) `projectionMatrix` × `matrixWorldInverse`, as a projector into a `width` × `height` box. */
export function cameraProjector(cam: { projectionMatrix: { elements: ArrayLike<number> }; matrixWorldInverse: { elements: ArrayLike<number> } }, width: number, height: number): Projector {
    const p = cam.projectionMatrix.elements, v = cam.matrixWorldInverse.elements;
    const m = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += p[k * 4 + r]! * v[c * 4 + k]!;
        m[c * 4 + r] = s;
    }
    // Clip → screen pixels folded in: sx = (x/w + 1)·W/2 ⇒ row0' = (row0 + row3)·W/2; sy = (1 − y/w)·H/2 ⇒ row1' = (row3 − row1)·H/2.
    const screen = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
        screen[c * 4] = (m[c * 4]! + m[c * 4 + 3]!) * width / 2;
        screen[c * 4 + 1] = (m[c * 4 + 3]! - m[c * 4 + 1]!) * height / 2;
        screen[c * 4 + 3] = m[c * 4 + 3]!;
    }
    // Pixels per world unit: an orthographic camera's x scale is 2 / (right − left) in NDC per world unit.
    const pxPerWorld = Math.abs(m[0]!) * width / 2 + Math.abs(m[8]!) * width / 2 || 1;
    return {
        width, height, pxPerWorld, key: `c|${width}|${height}|${Array.prototype.join.call(m, ',')}`, screen,
        project(x, y, z, out) {
            const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
            if (w <= 1e-9) return false;
            out[0] = ((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w + 1) * width / 2;
            out[1] = (1 - (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w) * height / 2;
            return true;
        },
    };
}

/**
 * `projector` as a screen matrix: its own when it has one; else derived from four probes when the projection is affine
 * (every orthographic view — the rig's tilted one included), checked on a fifth point; null when it is not (the caller
 * then calls `project` per point).
 */
export function screenMatrixOf(projector: Projector): Float64Array | null {
    if (projector.screen) return projector.screen;
    const o = new Float64Array(2), a = new Float64Array(2), b = new Float64Array(2), c = new Float64Array(2), d = new Float64Array(2);
    if (!projector.project(0, 0, 0, o) || !projector.project(1, 0, 0, a) || !projector.project(0, 1, 0, b) || !projector.project(0, 0, 1, c) || !projector.project(3, 5, 7, d)) return null;
    const m = Float64Array.from([a[0]! - o[0]!, a[1]! - o[1]!, 0, 0, b[0]! - o[0]!, b[1]! - o[1]!, 0, 0, c[0]! - o[0]!, c[1]! - o[1]!, 0, 0, o[0]!, o[1]!, 0, 1]);
    const px = 3 * m[0]! + 5 * m[4]! + 7 * m[8]! + m[12]!, py = 3 * m[1]! + 5 * m[5]! + 7 * m[9]! + m[13]!;
    const tol = 1e-6 * (1 + Math.abs(d[0]!) + Math.abs(d[1]!));
    return Math.abs(px - d[0]!) <= tol && Math.abs(py - d[1]!) <= tol ? m : null;
}

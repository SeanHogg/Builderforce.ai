/**
 * World → screen for the stage (PRD 43 B5): the fitted top-down frame, a three.js camera's matrices, and the rig's own
 * projection all as ONE {@link Projector}. The math is the shared `projection.ts` (the rig reads it too), so picking,
 * the a11y proxies, the captions and the camera never disagree. Picking reads a projector as a 4×4 screen matrix
 * ({@link screenMatrixOf}) so a settle projects every slot in one tight loop with the matrix inlined. Pure, no DOM, no three.
 */

import { fitView, groundScreenMatrix, projectGround, type GroundView } from './projection';
import type { Placement } from './types';

/** The orthographic top-down frame the stage fits a placement into. */
export interface ScreenFrame { zoom: number; cx: number; cz: number; width: number; height: number }

const groundOf = (f: ScreenFrame): GroundView => ({ cx: f.cx, cz: f.cz, zoom: f.zoom, tilt: 0, width: f.width, height: f.height });

/** The frame that fits `p`'s bounds into a `width` × `height` box (world x → screen x, world z → screen y). */
export function frameOf(p: Pick<Placement, 'bounds'>, width: number, height: number): ScreenFrame {
    return { ...fitView(p.bounds, width, height), width, height };
}

export function toScreen(f: ScreenFrame, x: number, z: number): [number, number] {
    const out: [number, number] = [0, 0];
    projectGround(groundOf(f), x, 0, z, out);
    return out;
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
    const view = groundOf(f);
    return {
        width: f.width, height: f.height, pxPerWorld: f.zoom, key: `f|${f.zoom}|${f.cx}|${f.cz}|${f.width}|${f.height}`, screen: groundScreenMatrix(view),
        project(x, y, z, out) { projectGround(view, x, y, z, out); return true; },
    };
}

type CameraLike = { projectionMatrix: { elements: ArrayLike<number> }; matrixWorldInverse: { elements: ArrayLike<number> } };

/**
 * A three.js camera as a projector, REUSED frame after frame (the canvas tap updates it every frame): the matrices are
 * written into scratch arrays and the key changes only when a view number does — no allocation, no string build per frame.
 */
export class CameraProjector implements Projector {
    width = 0;
    height = 0;
    pxPerWorld = 1;
    key = 'c0';
    /** Clip-space view-projection (`projectionMatrix × matrixWorldInverse`) and the same folded into screen pixels. */
    private readonly m = new Float64Array(16);
    readonly screen = new Float64Array(16);
    private version = 0;

    /** Re-reads `cam` in a `width` × `height` box; true when the projection changed (the key moved). */
    update(cam: CameraLike, width: number, height: number): boolean {
        const p = cam.projectionMatrix.elements, v = cam.matrixWorldInverse.elements, m = this.m;
        let changed = width !== this.width || height !== this.height;
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += p[k * 4 + r]! * v[c * 4 + k]!;
            if (m[c * 4 + r] !== s) { m[c * 4 + r] = s; changed = true; }
        }
        if (!changed) return false;
        this.width = width; this.height = height;
        // Clip → screen pixels folded in: sx = (x/w + 1)·W/2 ⇒ row0' = (row0 + row3)·W/2; sy = (1 − y/w)·H/2 ⇒ row1' = (row3 − row1)·H/2.
        for (let c = 0; c < 4; c++) {
            this.screen[c * 4] = (m[c * 4]! + m[c * 4 + 3]!) * width / 2;
            this.screen[c * 4 + 1] = (m[c * 4 + 3]! - m[c * 4 + 1]!) * height / 2;
            this.screen[c * 4 + 2] = 0;
            this.screen[c * 4 + 3] = m[c * 4 + 3]!;
        }
        // Pixels per world unit: an orthographic camera's x scale is 2 / (right − left) in NDC per world unit.
        this.pxPerWorld = Math.abs(m[0]!) * width / 2 + Math.abs(m[8]!) * width / 2 || 1;
        this.key = `c${++this.version}`;
        return true;
    }

    project(x: number, y: number, z: number, out: Float64Array): boolean {
        const s = this.screen;
        const w = s[3]! * x + s[7]! * y + s[11]! * z + s[15]!;
        if (w <= 1e-9) return false;
        out[0] = (s[0]! * x + s[4]! * y + s[8]! * z + s[12]!) / w;
        out[1] = (s[1]! * x + s[5]! * y + s[9]! * z + s[13]!) / w;
        return true;
    }
}

/** A one-off camera projector (tests, a measurement page): {@link CameraProjector} read once. */
export function cameraProjector(cam: CameraLike, width: number, height: number): Projector {
    const projector = new CameraProjector();
    projector.update(cam, width, height);
    return projector;
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

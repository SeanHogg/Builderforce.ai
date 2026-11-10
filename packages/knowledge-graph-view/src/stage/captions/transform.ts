/**
 * The caption layer's ONE transform (PRD 43 B3, Labels): the ground plane (world x, z) → the stage box's CSS px. Every
 * caption is laid out once at its world (x, z), in a container whose single CSS `matrix()` is this map — so a pan, a
 * zoom or a tilt (an orthographic camera keeps the ground plane affine) moves all of them with one style write and no
 * React commit. Each caption cancels the linear part with the inverse (a CSS custom property written in the same
 * write), so the text keeps its size and stays upright. The frame loop calls it every frame: no allocation, and no
 * style write when nothing moved.
 */

/** `matrix(a, b, c, d, e, f)`: screen = (a·x + c·z + e, b·x + d·z + f). */
export interface Affine2 { a: number; b: number; c: number; d: number; e: number; f: number }

/** World (x, y, z) → CSS px in the stage box, written to `out`. */
export type ProjectInto = (x: number, y: number, z: number, out: { 0: number; 1: number }) => void;

export const IDENTITY: Readonly<Affine2> = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const P0 = [0, 0] as [number, number], PX = [0, 0] as [number, number], PZ = [0, 0] as [number, number];

/** The ground plane's affine map under `project`, from three projected points (origin, +x, +z), into `out`. */
export function groundAffine(project: ProjectInto, out: Affine2 = { ...IDENTITY }): Affine2 {
    project(0, 0, 0, P0); project(1, 0, 0, PX); project(0, 0, 1, PZ);
    out.a = PX[0] - P0[0]; out.b = PX[1] - P0[1]; out.c = PZ[0] - P0[0]; out.d = PZ[1] - P0[1]; out.e = P0[0]; out.f = P0[1];
    return out;
}

/** The inverse of the linear part (no translation): what keeps a caption's text upright and at its own size. */
export function inverseLinear(m: Affine2): Affine2 {
    const det = m.a * m.d - m.b * m.c;
    if (Math.abs(det) < 1e-12) return { ...IDENTITY };
    return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: 0, f: 0 };
}

const n = (v: number): string => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1e6) / 1e6));
export const cssMatrix = (m: Affine2): string => `matrix(${n(m.a)}, ${n(m.b)}, ${n(m.c)}, ${n(m.d)}, ${n(m.e)}, ${n(m.f)})`;

/** Name of the custom property the container writes and every caption reads. */
export const INVERSE_VAR = '--kg-caption-inverse';

const same = (a: Affine2, b: Affine2): boolean => a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.e === b.e && a.f === b.f;

/**
 * Writes the ONE transform (and its inverse) onto the caption container — only when it differs from `last`, which is
 * updated. Returns whether it wrote.
 */
export function applyCaptionTransform(el: HTMLElement, m: Affine2, last?: Affine2): boolean {
    if (last && same(m, last)) return false;
    el.style.transform = cssMatrix(m);
    el.style.setProperty(INVERSE_VAR, cssMatrix(inverseLinear(m)));
    if (last) Object.assign(last, m);
    return true;
}

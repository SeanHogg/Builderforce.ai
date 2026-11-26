/**
 * Polylines → a {@link LinkBatch} for the stage's one line shader (PRD 43 B3, Links). The worker samples each corner the
 * way `roundedPath` (transit/geometry.ts) draws it — a quadratic of radius {@link CORNER} — into points, so the shader
 * only ever draws straight segments with round joins. Running length is carried per point, so dashes run on across
 * corners. Pure.
 */

import { CORNER, type Point } from '../../../surface/transit/geometry';
import type { LinkBatch, Vec3 } from '../../../stage/types';

/** Points per rounded corner. */
const CORNER_STEPS = 6;

/** A polyline with each interior corner replaced by `roundedPath`'s quadratic (same construction, sampled). */
export function roundedPoints(pts: readonly Point[], r: number = CORNER): Point[] {
    if (pts.length < 3) return [...pts];
    const out: Point[] = [pts[0]!];
    for (let i = 1; i < pts.length - 1; i++) {
        const p0 = pts[i - 1]!, p1 = pts[i]!, p2 = pts[i + 1]!;
        const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
        const k = Math.min(r, d1 / 2, d2 / 2);
        const s = { x: p1.x - ((p1.x - p0.x) / d1) * k, y: p1.y - ((p1.y - p0.y) / d1) * k };
        const e = { x: p1.x + ((p2.x - p1.x) / d2) * k, y: p1.y + ((p2.y - p1.y) / d2) * k };
        for (let j = 0; j <= CORNER_STEPS; j++) {
            const t = j / CORNER_STEPS, u = 1 - t;
            out.push({ x: u * u * s.x + 2 * u * t * p1.x + t * t * e.x, y: u * u * s.y + 2 * u * t * p1.y + t * t * e.y });
        }
    }
    out.push(pts[pts.length - 1]!);
    return out;
}

export interface LinkPath {
    /** Plane points (x, y in the camera's 2D frame); placed at height `y` in the world. */
    pts: readonly Point[];
    tone: number;
    width: number;
    dash: number;
    flags: number;
}

/** One batch of polylines at world height `y`: the map's frame (x, y) is the world's (x, z). */
export function linkBatch(family: LinkBatch['family'], paths: readonly LinkPath[], y: number, casing?: LinkBatch['casing']): LinkBatch {
    const lifted = paths.map((p) => ({ ...p, pts: roundedPoints(p.pts).map((q): Vec3 => [q.x, y, q.y]) }));
    return polylineBatch(family, lifted, 'world', casing);
}

/** A polyline already in world space (x, y, z): straight segments, no corner rounding (the mind map's tree, the sequence). */
export interface WorldPath {
    pts: readonly Vec3[];
    tone: number;
    width: number;
    dash: number;
    flags: number;
}

/** The ONE packer of polylines into a {@link LinkBatch}: a NaN triple ends each polyline; running length runs per polyline. */
export function polylineBatch(family: LinkBatch['family'], paths: readonly WorldPath[], widthUnit: LinkBatch['widthUnit'], casing?: LinkBatch['casing']): LinkBatch {
    let points = 0, segments = 0;
    for (const p of paths) { points += p.pts.length + 1; segments += Math.max(0, p.pts.length - 1); }
    const xyz = new Float32Array(points * 3), run = new Float32Array(points);
    const tone = new Uint8Array(segments), width = new Float32Array(segments), dash = new Uint8Array(segments), flags = new Uint8Array(segments), group = new Uint32Array(segments);
    let pi = 0, si = 0;
    paths.forEach((p, g) => {
        const pts = p.pts;
        let length = 0;
        pts.forEach((q, i) => {
            if (i > 0) {
                const o = pts[i - 1]!;
                length += Math.hypot(q[0] - o[0], q[1] - o[1], q[2] - o[2]);
                tone[si] = p.tone; width[si] = p.width; dash[si] = p.dash; flags[si] = p.flags; group[si] = g; si++;
            }
            xyz[pi * 3] = q[0]; xyz[pi * 3 + 1] = q[1]; xyz[pi * 3 + 2] = q[2]; run[pi] = length; pi++;
        });
        xyz[pi * 3] = NaN; xyz[pi * 3 + 1] = NaN; xyz[pi * 3 + 2] = NaN; run[pi] = length; pi++;
    });
    return { family, points: xyz, runLength: run, tone, width, dash, flags, group, ...(casing ? { casing } : {}), widthUnit };
}

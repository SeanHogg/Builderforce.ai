/**
 * Where the perspective Map's camera aims and how much it must keep in frame. The layout's plate is always the viewport
 * band wide (960), so fitting the PLATE framed a level of one or two stops (a line with a single stop) as a speck in an
 * empty field. The fit is the drawn CONTENT (stations and route points) plus a margin, clamped to the plate and never
 * narrower than {@link MIN_FIT_EXTENT}, so a sparse level reads at a sane size and a full one frames the whole plate.
 */

/** World units kept round the content: a few mark diameters, the labels and the casing. */
export const FIT_PAD = 56;
/** The least world extent (either axis) the fit may shrink to. */
export const MIN_FIT_EXTENT = 180;
/** Slack the orbit keeps beyond the content's sphere. */
const RADIUS_SLACK = 12;

export interface MapFit { cx: number; cz: number; radius: number }

type Pt = { readonly x: number; readonly y: number };

export function mapFit(plate: { width: number; height: number }, points: Iterable<Pt>, top: number): MapFit {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y);
    }
    if (minX > maxX) { minX = 0; maxX = plate.width; minZ = 0; maxZ = plate.height; }
    const grow = (lo: number, hi: number, limit: number): [number, number] => {
        let a = Math.max(0, lo - FIT_PAD), b = Math.min(limit, hi + FIT_PAD);
        const short = Math.min(MIN_FIT_EXTENT, limit) - (b - a);
        if (short > 0) { a = Math.max(0, a - short / 2); b = Math.min(limit, a + Math.min(MIN_FIT_EXTENT, limit)); a = Math.max(0, b - Math.min(MIN_FIT_EXTENT, limit)); }
        return [a, b];
    };
    const [x0, x1] = grow(minX, maxX, plate.width), [z0, z1] = grow(minZ, maxZ, plate.height);
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, radius: Math.hypot(x1 - x0, z1 - z0, top) / 2 + RADIUS_SLACK };
}

/** The content a Map placement draws: every drawn station and every route point. */
export function contentPoints(positions: ReadonlyMap<string, Pt>, drawn: readonly string[], routes: readonly { pts: readonly Pt[] }[]): Pt[] {
    const out: Pt[] = [];
    for (const id of drawn) { const p = positions.get(id); if (p) out.push(p); }
    for (const r of routes) out.push(...r.pts);
    return out;
}

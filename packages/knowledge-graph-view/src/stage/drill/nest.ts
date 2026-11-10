/**
 * A zoom-entered level, nested in its parent mark (PRD 43 B1a rules 5 and 9). The drill's placement (`placeDrill`) is
 * laid out in its own frame; when the ZOOM entered it, it is scaled into the parent mark's footprint — centred on the
 * parent, `NEST_SPREAD` parent diameters across — so the level appears where the person is zooming and the zoom goes on
 * continuously, never a camera jump:
 *
 *   - a slot the level SHOWS is moved and scaled into the footprint (position, scale, extrude; world-sized link widths,
 *     casings and labels with it; planes and captions too);
 *   - a slot the level HIDES stays exactly where the placement on show had it (scale 0), so the members grow out of the
 *     parent (where the outer placement parked them) and everything else shrinks in place; going back out is the outer
 *     placement again, which parks the members at their parent: they fold in;
 *   - the bounds and the rig are the OUTER placement's, so the rig keeps the person's zoom (no re-home) and Fit still
 *     frames the whole map.
 *
 * Pure.
 */

import { NEST_SPREAD } from '../labels/lod';
import type { LinkBatch, Placement, Vec3 } from '../types';

export interface NestEntry {
    /** The level's drill key (`<level>:<ref>`, `request.ts` `drillKeyOf`). */
    drill: string;
    /** The parent mark's world centre and drawn diameter (2 × its scale) when the zoom entered it. */
    centre: Vec3;
    diameter: number;
    /** The placement on show when the zoom entered: hidden slots stay where it had them; its bounds and rig are kept. */
    outer: Placement;
}

/** The entry for going into slot `slot` of the placement on show; null when that slot is not drawn. */
export function nestEntryOf(outer: Placement, slot: number, drill: string): NestEntry | null {
    const scale = outer.scale[slot] ?? 0;
    if (slot < 0 || !(scale > 0)) return null;
    return { drill, centre: [outer.position[slot * 3]!, outer.position[slot * 3 + 1]!, outer.position[slot * 3 + 2]!], diameter: 2 * scale, outer };
}

/** The drill key a placement was built for (its cache key's drill field); '' for none. */
export const drillOfPlacement = (p: Pick<Placement, 'cacheKey'>): string => p.cacheKey.split('|')[2] ?? '';

export function nestPlacement(raw: Placement, e: NestEntry): Placement {
    const { min, max } = raw.bounds;
    const s = (e.diameter * NEST_SPREAD) / Math.max(max[0] - min[0], max[2] - min[2], 1e-6);
    const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
    const [ox, oy, oz] = e.centre;
    const at = (x: number, y: number, z: number): Vec3 => [ox + (x - cx) * s, oy + y * s, oz + (z - cz) * s];

    const n = raw.scale.length, outer = e.outer, held = outer.scale.length;
    const position = new Float32Array(n * 3), scale = new Float32Array(n), extrude = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const shown = (raw.scale[i] ?? 0) > 0;
        if (!shown && i < held) {
            position[i * 3] = outer.position[i * 3]!; position[i * 3 + 1] = outer.position[i * 3 + 1]!; position[i * 3 + 2] = outer.position[i * 3 + 2]!;
            continue;
        }
        const p = at(raw.position[i * 3]!, raw.position[i * 3 + 1]!, raw.position[i * 3 + 2]!);
        position[i * 3] = p[0]; position[i * 3 + 1] = p[1]; position[i * 3 + 2] = p[2];
        if (shown) { scale[i] = raw.scale[i]! * s; extrude[i] = raw.extrude[i]! * s; }
    }

    const link = (b: LinkBatch): LinkBatch => {
        const points = b.points.slice();
        for (let k = 0; k < points.length; k += 3) {
            if (Number.isNaN(points[k]!)) continue;
            const p = at(points[k]!, points[k + 1]!, points[k + 2]!);
            points[k] = p[0]; points[k + 1] = p[1]; points[k + 2] = p[2];
        }
        const world = b.widthUnit === 'world';
        return {
            ...b, points, runLength: b.runLength.map((r) => r * s),
            width: world ? b.width.map((w) => w * s) : b.width,
            ...(b.casing ? { casing: { ...b.casing, extra: world ? b.casing.extra * s : b.casing.extra } } : {}),
        };
    };
    return {
        ...raw,
        cacheKey: `${raw.cacheKey}|nest:${e.centre.join(',')}:${e.diameter}`,
        position, scale, extrude,
        links: raw.links.map(link),
        planes: raw.planes.map((pl) => ({ ...pl, min: at(...pl.min), max: at(...pl.max) })),
        captions: raw.captions.map((c) => ({ ...c, position: at(...c.position) })),
        labels: raw.labels.map((r) => (r.scale === 'world'
            ? { ...r, size: r.size * s, offsetPx: [r.offsetPx[0] * s, r.offsetPx[1] * s] as [number, number], halo: { ...r.halo, px: r.halo.px * s } }
            : r)),
        bounds: outer.bounds,
        rig: outer.rig,
    };
}

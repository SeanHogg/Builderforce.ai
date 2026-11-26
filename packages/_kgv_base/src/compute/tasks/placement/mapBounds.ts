/**
 * Map placement bounds must cover what the stage actually draws, not only the station box.
 * A route's casing (line width + the background extra) and the describes / wall decorations sit
 * outside that box; a document frame fitted to the box then clips them (`overflow: clip`).
 */

import type { LinkBatch, Vec3 } from '../../../stage/types';
import type { HopRoute } from '../../../surface/transitLayout';

export interface MapBounds {
    min: Vec3;
    max: Vec3;
}

/** Half the drawn width of a link batch, in world units (px-width batches do not widen the world box). */
function worldPad(batch: LinkBatch): number {
    if (batch.widthUnit !== 'world') return 0;
    let w = 0;
    for (let i = 0; i < batch.width.length; i++) w = Math.max(w, batch.width[i] ?? 0);
    return (w + (batch.casing?.extra ?? 0)) / 2;
}

/**
 * The station box, grown by every route point's casing and every decoration point's width.
 * `top` is the tallest tower (world y); map y is world z.
 */
export function widenMapBounds(
    layout: { width: number; height: number; routes: readonly Pick<HopRoute, 'pts' | 'lineId'>[] },
    widths: ReadonlyMap<string, number>,
    neutralWidth: number,
    casingExtra: number,
    top: number,
    decor: readonly LinkBatch[],
): MapBounds {
    let minX = 0, minZ = 0, maxX = layout.width, maxY = top, maxZ = layout.height;
    const grow = (x: number, y: number, z: number, pad: number): void => {
        if (Number.isNaN(x) || Number.isNaN(z)) return;
        minX = Math.min(minX, x - pad);
        maxX = Math.max(maxX, x + pad);
        minZ = Math.min(minZ, z - pad);
        maxZ = Math.max(maxZ, z + pad);
        if (!Number.isNaN(y)) maxY = Math.max(maxY, y);
    };
    for (const route of layout.routes) {
        const pad = ((widths.get(route.lineId) ?? neutralWidth) + casingExtra) / 2;
        for (const p of route.pts) grow(p.x, 0, p.y, pad);
    }
    for (const batch of decor) {
        const pad = worldPad(batch);
        const pts = batch.points;
        for (let i = 0; i < pts.length; i += 3) grow(pts[i]!, pts[i + 1]!, pts[i + 2]!, pad);
    }
    return { min: [minX, 0, minZ], max: [maxX, maxY, maxZ] };
}

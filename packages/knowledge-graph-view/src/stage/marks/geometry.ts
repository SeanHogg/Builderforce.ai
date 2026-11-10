/**
 * A mark's geometry: the SIDE WALLS of its shape's extruded outline (`shapeGeometry.ts`, the ONE
 * extrusion of the `shapes.ts` outlines) plus ONE cap quad on top, tagged by `aPart` (0 wall, 1 cap). The cap is drawn by
 * the silhouette SDF shader (`shader.ts`), so the top face is anti-aliased without MSAA; the walls give depth when the
 * mark is extruded and vanish (zero height) when it is flat. One geometry per shape for the page's lifetime; each batch
 * mesh shares its position and part attributes.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import { shapeGeometry } from './shapeGeometry';
import type { NodeShape } from '../../shapes';

/** ExtrudeGeometry's material group of the side walls (0 is the lids). */
const SIDE_GROUP = 1;

const CACHE = new Map<NodeShape, { position: BufferAttribute; part: BufferAttribute }>();

/** The unit cap quad, at the top of the unit extrusion (y = 0.5): corners ±1, scaled per instance by the shader. */
const CAP = [-1, 0.5, -1, 1, 0.5, -1, 1, 0.5, 1, -1, 0.5, -1, 1, 0.5, 1, -1, 0.5, 1];

function partsOf(shape: NodeShape): { position: BufferAttribute; part: BufferAttribute } {
    let parts = CACHE.get(shape);
    if (parts) return parts;
    const extruded = shapeGeometry(shape);
    const src = extruded.getAttribute('position');
    const sides = extruded.groups.filter((g) => g.materialIndex === SIDE_GROUP);
    const wallVerts = sides.reduce((n, g) => n + g.count, 0);
    const index = extruded.getIndex();
    const out = new Float32Array((wallVerts + CAP.length / 3) * 3);
    let o = 0;
    for (const g of sides) {
        for (let k = g.start; k < g.start + g.count; k++) {
            const v = index ? index.getX(k) : k;
            out[o++] = src.getX(v); out[o++] = src.getY(v); out[o++] = src.getZ(v);
        }
    }
    out.set(CAP, o);
    const part = new Float32Array(wallVerts + CAP.length / 3);
    part.fill(1, wallVerts);
    parts = { position: new BufferAttribute(out, 3), part: new BufferAttribute(part, 1) };
    CACHE.set(shape, parts);
    return parts;
}

/** A fresh geometry for one batch mesh, sharing the shape's (uploaded-once) position and part attributes. */
export function markGeometry(shape: NodeShape): BufferGeometry {
    const { position, part } = partsOf(shape);
    const g = new BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('aPart', part);
    return g;
}

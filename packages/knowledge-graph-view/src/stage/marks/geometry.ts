/**
 * A mark's geometry: the SIDE WALLS of its shape's extruded outline (`shapeGeometry.ts`, the ONE
 * extrusion of the `shapes.ts` outlines) plus ONE cap quad on top, tagged by `aPart` (0 wall, 1 cap; the shader also draws the cap quad a second time as the contact SHADOW, part 2). The cap is drawn by
 * the silhouette SDF shader (`shader.ts`), so the top face is anti-aliased without MSAA; the walls give depth when the
 * mark is extruded and vanish (zero height) when it is flat. One geometry per shape for the page's lifetime; each batch
 * mesh shares its position and part attributes.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import { shapeGeometry } from './shapeGeometry';
import type { NodeShape } from '../../shapes';

/** ExtrudeGeometry's material group of the side walls (0 is the lids). */
const SIDE_GROUP = 1;

const CACHE = new Map<NodeShape, { position: BufferAttribute; part: BufferAttribute; normal: BufferAttribute }>();

/** The unit cap quad, at the top of the unit extrusion (y = 0.5): corners ±1, scaled per instance by the shader. */
const CAP = [-1, 0.5, -1, 1, 0.5, -1, 1, 0.5, 1, -1, 0.5, -1, 1, 0.5, 1, -1, 0.5, 1];

function partsOf(shape: NodeShape): { position: BufferAttribute; part: BufferAttribute; normal: BufferAttribute } {
    let parts = CACHE.get(shape);
    if (parts) return parts;
    const extruded = shapeGeometry(shape);
    const src = extruded.getAttribute('position');
    const sides = extruded.groups.filter((g) => g.materialIndex === SIDE_GROUP);
    const wallVerts = sides.reduce((n, g) => n + g.count, 0);
    const index = extruded.getIndex();
    const quads = CAP.length / 3;
    const out = new Float32Array((wallVerts + 2 * quads) * 3);
    const normals = new Float32Array(out.length);
    const srcNormal = extruded.getAttribute('normal');
    let o = 0;
    for (const g of sides) {
        for (let k = g.start; k < g.start + g.count; k++) {
            const v = index ? index.getX(k) : k;
            normals[o] = srcNormal.getX(v); normals[o + 1] = srcNormal.getY(v); normals[o + 2] = srcNormal.getZ(v);
            out[o++] = src.getX(v); out[o++] = src.getY(v); out[o++] = src.getZ(v);
        }
    }
    out.set(CAP, o);
    out.set(CAP, o + CAP.length); // the same quad again: the contact shadow (part 2)
    for (let k = o + 1; k < normals.length; k += 3) normals[k] = 1; // the cap (and the contact shadow drawn from it) faces up
    const part = new Float32Array(wallVerts + 2 * quads);
    part.fill(1, wallVerts, wallVerts + quads);
    part.fill(2, wallVerts + quads);
    parts = { position: new BufferAttribute(out, 3), part: new BufferAttribute(part, 1), normal: new BufferAttribute(normals, 3) };
    CACHE.set(shape, parts);
    return parts;
}

/** A fresh geometry for one batch mesh, sharing the shape's (uploaded-once) position and part attributes. */
export function markGeometry(shape: NodeShape): BufferGeometry {
    const { position, part, normal } = partsOf(shape);
    const g = new BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('aPart', part);
    g.setAttribute('normal', normal);
    return g;
}

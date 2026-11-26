/**
 * A shape's 3D primitive (PRD 43 B1a rule 2): its 2D outline (`SHAPE_OUTLINES`, the ONE registry every view draws)
 * extruded to height 1 along +Y and centred, radius about 1 — so a mark reads the same from above and in depth. One
 * geometry per shape for the page's lifetime, shared by every batch that draws it (`geometry.ts` takes its side walls).
 */

import { type BufferGeometry, ExtrudeGeometry, Shape } from 'three';
import { SHAPE_OUTLINES, type NodeShape } from '../../shapes';

const GEOMETRIES = new Map<NodeShape, BufferGeometry>();

export function shapeGeometry(shape: NodeShape): BufferGeometry {
    let g = GEOMETRIES.get(shape);
    if (!g) {
        const outline = SHAPE_OUTLINES[shape];
        const s = new Shape();
        outline.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
        s.closePath();
        g = new ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 1 });
        // Outline y → world z (seen from above), extrusion z → world y, centred on the origin.
        g.rotateX(Math.PI / 2).translate(0, 0.5, 0);
        g.computeVertexNormals();
        GEOMETRIES.set(shape, g);
    }
    return g;
}

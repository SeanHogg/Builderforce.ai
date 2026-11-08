import { appendMesh, emptyMesh, prismMesh, type TriMesh } from '../mesh/triMesh';
import { circleOutline, rectOutline, visibleShapes, type Point } from './cadGeometry';
import type { CadState } from './cadState';

export const DEFAULT_PLATE_THICKNESS_MM = 1;
const CIRCLE_SEGMENTS = 32;

/**
 * The drawing lifted into a solid: every closed shape (rectangle, circle, closed
 * polyline) becomes a flat plate `thicknessMm` thick — laser-cut panels and printable
 * plaques from a floor plan or part outline.
 *
 * Open geometry (lines, open polylines, dimensions, text) has no inside to extrude and is
 * left out. Plates do not merge, so a hole drawn inside an outline is a second plate on
 * top of it, not a cut through it; boolean cutting needs a solid-modelling kernel.
 * Y is flipped about the sheet height so the part is not mirrored.
 */
export function cadToMesh(state: CadState, thicknessMm = DEFAULT_PLATE_THICKNESS_MM): TriMesh {
  const mesh = emptyMesh();
  const up = (points: readonly Point[]): Point[] => points.map((point) => ({ x: point.x, y: state.heightMm - point.y }));
  for (const shape of visibleShapes(state)) {
    if (shape.kind === 'rect') appendMesh(mesh, prismMesh(up(rectOutline(shape)), 0, thicknessMm));
    else if (shape.kind === 'circle') appendMesh(mesh, prismMesh(up(circleOutline(shape, CIRCLE_SEGMENTS)), 0, thicknessMm));
    else if (shape.kind === 'polyline' && shape.closed) appendMesh(mesh, prismMesh(up(shape.points), 0, thicknessMm));
  }
  return mesh;
}

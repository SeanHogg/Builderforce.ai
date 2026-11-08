import { layerOf, type CadDimension, type CadShape, type CadState } from './cadState';

/**
 * The geometry every consumer of a drawing agrees on: how big a shape is, whether a
 * point is on it, where a dimension's lines run, and which colour a shape is drawn in.
 *
 * The canvas renderer, the SVG, DXF and PDF writers and the editor's hit-testing all
 * ask here, so a dimension drawn on screen and the same dimension in the exported file
 * cannot drift apart.
 */

export interface Box { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

export const DEFAULT_STROKE_MM = 0.25;
/** What a shape with neither a colour nor a layer is drawn in: the surface's own ink. */
const FALLBACK_INK = 'currentcolor';

export function shapeColor(state: CadState, shape: CadShape): string {
  return shape.color ?? layerOf(state, shape.layer)?.color ?? FALLBACK_INK;
}

/** Shapes that are drawn and exported: those on a visible layer, back to front. */
export function visibleShapes(state: CadState): CadShape[] {
  return state.shapes.filter((shape) => layerOf(state, shape.layer)?.visible !== false);
}

export function shapeBounds(shape: CadShape): Box | null {
  switch (shape.kind) {
    case 'line':
    case 'dimension':
      return { x: Math.min(shape.x1, shape.x2), y: Math.min(shape.y1, shape.y2), width: Math.abs(shape.x2 - shape.x1), height: Math.abs(shape.y2 - shape.y1) };
    case 'rect':
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    case 'circle':
      return { x: shape.cx - shape.radius, y: shape.cy - shape.radius, width: shape.radius * 2, height: shape.radius * 2 };
    case 'polyline': {
      if (!shape.points.length) return null;
      const xs = shape.points.map((point) => point.x);
      const ys = shape.points.map((point) => point.y);
      const [x, y] = [Math.min(...xs), Math.min(...ys)];
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    case 'text':
      // Font metrics are not available here, so the box is a conservative estimate.
      return { x: shape.x, y: shape.y - shape.heightMm, width: shape.text.length * shape.heightMm * 0.6, height: shape.heightMm };
  }
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Whether `point` is on the shape within `toleranceMm`. A rectangle or a text run is hit anywhere inside its box; the rest only on their line. */
export function hitsShape(shape: CadShape, point: Point, toleranceMm: number): boolean {
  switch (shape.kind) {
    case 'line':
    case 'dimension':
      return distanceToSegment(point, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <= toleranceMm;
    case 'rect': {
      const inside = point.x >= shape.x - toleranceMm && point.x <= shape.x + shape.width + toleranceMm
        && point.y >= shape.y - toleranceMm && point.y <= shape.y + shape.height + toleranceMm;
      return inside;
    }
    case 'circle':
      return Math.hypot(point.x - shape.cx, point.y - shape.cy) <= shape.radius + toleranceMm;
    case 'polyline': {
      const edges = shape.closed ? shape.points.length : shape.points.length - 1;
      for (let index = 0; index < edges; index += 1) {
        if (distanceToSegment(point, shape.points[index]!, shape.points[(index + 1) % shape.points.length]!) <= toleranceMm) return true;
      }
      return false;
    }
    case 'text': {
      const box = shapeBounds(shape)!;
      return point.x >= box.x - toleranceMm && point.x <= box.x + box.width + toleranceMm && point.y >= box.y - toleranceMm && point.y <= box.y + box.height + toleranceMm;
    }
  }
}

/** The topmost selectable shape under `point`: later shapes win, hidden and locked layers are skipped. */
export function topmostShapeAt(state: CadState, point: Point, toleranceMm: number): CadShape | null {
  for (let index = state.shapes.length - 1; index >= 0; index -= 1) {
    const shape = state.shapes[index]!;
    const layer = layerOf(state, shape.layer);
    if (layer && (!layer.visible || layer.locked)) continue;
    if (hitsShape(shape, point, toleranceMm)) return shape;
  }
  return null;
}

/* ---------- outlines ---------- */

/** The corners of a rectangle, rounded when it has a radius (each corner approximated by `cornerSegments` chords). */
export function rectOutline(rect: Extract<CadShape, { kind: 'rect' }>, cornerSegments = 6): Point[] {
  const { x, y, width, height } = rect;
  const radius = Math.min(rect.cornerRadius ?? 0, Math.abs(width) / 2, Math.abs(height) / 2);
  if (radius <= 0) return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
  const corners: Array<[number, number, number]> = [
    [x + width - radius, y + radius, -Math.PI / 2],
    [x + width - radius, y + height - radius, 0],
    [x + radius, y + height - radius, Math.PI / 2],
    [x + radius, y + radius, Math.PI],
  ];
  return corners.flatMap(([cx, cy, from]) => Array.from({ length: cornerSegments + 1 }, (_, step): Point => {
    const angle = from + (step / cornerSegments) * (Math.PI / 2);
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  }));
}

/** A circle as `segments` points around it. */
export function circleOutline(circle: Extract<CadShape, { kind: 'circle' }>, segments = 32): Point[] {
  return Array.from({ length: segments }, (_, step): Point => {
    const angle = (step / segments) * Math.PI * 2;
    return { x: circle.cx + Math.cos(angle) * circle.radius, y: circle.cy + Math.sin(angle) * circle.radius };
  });
}

/* ---------- dimensions ---------- */

const UNIT_PER_MM: Record<CadState['unit'], number> = { mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4, ft: 1 / 304.8 };

/** A measured length in mm, written in the sheet's unit. */
export function formatLength(mm: number, unit: CadState['unit']): string {
  const value = mm * UNIT_PER_MM[unit];
  const digits = unit === 'mm' ? 1 : unit === 'cm' ? 2 : 3;
  return `${Number(value.toFixed(digits))}${unit}`;
}

export interface DimensionGeometry {
  /** The dimension line, parallel to the measured segment and pushed out by the offset. */
  line: [Point, Point];
  /** The two extension lines from the measured points out to the dimension line. */
  extensions: [[Point, Point], [Point, Point]];
  label: string;
  labelAt: Point;
  lengthMm: number;
}

/** Null for a zero-length dimension, which has no direction to offset along. */
export function dimensionGeometry(dimension: CadDimension, unit: CadState['unit']): DimensionGeometry | null {
  const dx = dimension.x2 - dimension.x1;
  const dy = dimension.y2 - dimension.y1;
  const lengthMm = Math.hypot(dx, dy);
  if (lengthMm === 0) return null;
  const offX = (-dy / lengthMm) * dimension.offsetMm;
  const offY = (dx / lengthMm) * dimension.offsetMm;
  const a: Point = { x: dimension.x1 + offX, y: dimension.y1 + offY };
  const b: Point = { x: dimension.x2 + offX, y: dimension.y2 + offY };
  return {
    line: [a, b],
    extensions: [[{ x: dimension.x1, y: dimension.y1 }, a], [{ x: dimension.x2, y: dimension.y2 }, b]],
    label: dimension.label ?? formatLength(lengthMm, unit),
    labelAt: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    lengthMm,
  };
}

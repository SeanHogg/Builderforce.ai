import { makeShapeId, type CadShape, type CadState } from './cadState';
import type { Point } from './cadGeometry';

/**
 * The drawing tools, as pure functions: a drag from `start` to `end` becomes a shape (or
 * nothing, when the drag was a stray tap). The stage owns the pointer; this owns what a
 * gesture MEANS, so the same rules can be tested without a canvas.
 */

export type CadDrawTool = 'line' | 'rect' | 'circle' | 'dimension';
export type CadTool = 'select' | CadDrawTool;

export const CAD_DRAW_TOOLS: readonly CadDrawTool[] = ['line', 'rect', 'circle', 'dimension'];
export const CAD_TOOLS: readonly CadTool[] = ['select', ...CAD_DRAW_TOOLS];

/** A drag shorter than this (mm) is a tap, not a shape. */
const MIN_EXTENT_MM = 0.5;
/** How far a new dimension line sits from the segment it measures. */
export const DEFAULT_DIMENSION_OFFSET_MM = 10;

export interface CadPen {
  layer: string;
  /** `#rrggbb`, or undefined to inherit the layer's colour. */
  color?: string;
  strokeWidthMm?: number;
}

/** The shape a drag from `start` to `end` makes with `tool`, or null for a tap. */
export function shapeFromDrag(tool: CadDrawTool, start: Point, end: Point, pen: CadPen, id: string = makeShapeId()): CadShape | null {
  const base = { id, layer: pen.layer, ...(pen.color ? { color: pen.color } : {}), ...(pen.strokeWidthMm ? { strokeWidthMm: pen.strokeWidthMm } : {}) };
  switch (tool) {
    case 'line':
      return Math.hypot(end.x - start.x, end.y - start.y) < MIN_EXTENT_MM ? null : { ...base, kind: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    case 'dimension':
      return Math.hypot(end.x - start.x, end.y - start.y) < MIN_EXTENT_MM ? null : { ...base, kind: 'dimension', x1: start.x, y1: start.y, x2: end.x, y2: end.y, offsetMm: DEFAULT_DIMENSION_OFFSET_MM };
    case 'rect': {
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      return width < MIN_EXTENT_MM || height < MIN_EXTENT_MM ? null : { ...base, kind: 'rect', x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height };
    }
    case 'circle': {
      const radius = Math.hypot(end.x - start.x, end.y - start.y);
      return radius < MIN_EXTENT_MM ? null : { ...base, kind: 'circle', cx: start.x, cy: start.y, radius };
    }
  }
}

/** Snap a point to the grid's snap spacing when snapping is on, and keep it on the sheet. */
export function snapPoint(state: CadState, point: Point): Point {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const { snapEnabled, snapSpacingMm } = state.grid;
  const snap = (value: number) => (snapEnabled && snapSpacingMm > 0 ? Math.round(value / snapSpacingMm) * snapSpacingMm : value);
  return { x: clamp(snap(point.x), state.widthMm), y: clamp(snap(point.y), state.heightMm) };
}

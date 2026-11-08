import { dimensionGeometry, DEFAULT_STROKE_MM, shapeBounds, shapeColor, visibleShapes } from './cadGeometry';
import type { CadShape, CadState } from './cadState';

/**
 * Paints a drawing onto a 2D canvas context. The React stage owns the pointer; this
 * owns the pixels, and the SVG/DXF/PDF writers read the same geometry
 * (`cadGeometry.ts`), so what is on screen is what leaves in the file.
 *
 * Every primitive takes `zoom` (mm → pixels) and applies it itself, so stroke weights
 * scale with the sheet rather than being re-derived at each call site.
 */

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The caller normally passes the theme's accent; without one the outline follows the canvas's own text colour. */
const DEFAULT_SELECTION_INK = 'currentColor';

export interface CadDrawOptions {
  /** Millimetres → pixels. */
  zoom: number;
  /** The shape being drawn by the active tool, painted dashed on top. */
  inFlight?: CadShape | null;
  /** Ids to outline as selected. */
  selectedIds?: readonly string[];
  /** The selection outline colour — the editor passes the theme's accent. */
  selectionInk?: string;
  /** The sheet's paper and grid colours (export palette roles `paper` and `gridLine`, resolved by the caller). */
  paper: string;
  gridInk: string;
}

export function drawCad(ctx: Context, state: CadState, options: CadDrawOptions): void {
  const { zoom } = options;
  const width = state.widthMm * zoom;
  const height = state.heightMm * zoom;
  ctx.fillStyle = options.paper;
  ctx.fillRect(0, 0, width, height);
  if (state.grid.showGrid) paintGrid(ctx, state, zoom, options.gridInk);
  const selected = new Set(options.selectedIds ?? []);
  const selectionInk = options.selectionInk || DEFAULT_SELECTION_INK;
  for (const shape of visibleShapes(state)) paintShape(ctx, state, shape, zoom, selected.has(shape.id) ? selectionInk : null);
  if (options.inFlight) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    paintShape(ctx, state, options.inFlight, zoom, null);
    ctx.restore();
  }
}

function paintGrid(ctx: Context, state: CadState, zoom: number, ink: string): void {
  const spacing = state.grid.visibleSpacingMm * zoom;
  // A grid finer than two pixels is a grey wash, not a grid.
  if (spacing < 2) return;
  const width = state.widthMm * zoom;
  const height = state.heightMm * zoom;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width + 0.5; x += spacing) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
  for (let y = 0; y <= height + 0.5; y += spacing) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
  ctx.stroke();
  ctx.restore();
}

function paintShape(ctx: Context, state: CadState, shape: CadShape, zoom: number, selectionInk: string | null): void {
  ctx.save();
  ctx.strokeStyle = shapeColor(state, shape);
  ctx.lineWidth = Math.max(1, (shape.strokeWidthMm ?? DEFAULT_STROKE_MM) * zoom);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (shape.kind) {
    case 'line':
      ctx.beginPath(); ctx.moveTo(shape.x1 * zoom, shape.y1 * zoom); ctx.lineTo(shape.x2 * zoom, shape.y2 * zoom); ctx.stroke();
      break;
    case 'rect': paintRect(ctx, shape, zoom); break;
    case 'circle':
      ctx.beginPath(); ctx.arc(shape.cx * zoom, shape.cy * zoom, shape.radius * zoom, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'polyline':
      ctx.beginPath();
      shape.points.forEach((point, index) => (index ? ctx.lineTo(point.x * zoom, point.y * zoom) : ctx.moveTo(point.x * zoom, point.y * zoom)));
      if (shape.closed) ctx.closePath();
      ctx.stroke();
      break;
    case 'dimension': paintDimension(ctx, state, shape, zoom); break;
    case 'text':
      ctx.fillStyle = ctx.strokeStyle as string;
      ctx.font = `${Math.max(8, shape.heightMm * zoom)}px sans-serif`;
      ctx.translate(shape.x * zoom, shape.y * zoom);
      if (shape.rotation) ctx.rotate((-shape.rotation * Math.PI) / 180);
      ctx.fillText(shape.text, 0, 0);
      break;
  }
  ctx.restore();
  if (selectionInk) {
    const box = shapeBounds(shape);
    if (box) {
      ctx.save();
      ctx.strokeStyle = selectionInk;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(box.x * zoom - 3, box.y * zoom - 3, box.width * zoom + 6, box.height * zoom + 6);
      ctx.restore();
    }
  }
}

function paintRect(ctx: Context, shape: Extract<CadShape, { kind: 'rect' }>, zoom: number): void {
  const [x, y, w, h] = [shape.x * zoom, shape.y * zoom, shape.width * zoom, shape.height * zoom];
  if (!shape.cornerRadius) { ctx.strokeRect(x, y, w, h); return; }
  const r = Math.min(shape.cornerRadius * zoom, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.stroke();
}

function paintDimension(ctx: Context, state: CadState, shape: Extract<CadShape, { kind: 'dimension' }>, zoom: number): void {
  const geometry = dimensionGeometry(shape, state.unit);
  if (!geometry) return;
  ctx.beginPath();
  for (const [from, to] of [geometry.line, ...geometry.extensions]) { ctx.moveTo(from.x * zoom, from.y * zoom); ctx.lineTo(to.x * zoom, to.y * zoom); }
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle as string;
  ctx.font = `${Math.max(10, 3 * zoom)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(geometry.label, geometry.labelAt.x * zoom, geometry.labelAt.y * zoom - 2);
}

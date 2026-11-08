import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  beginStrokePath, endStrokePath, eraseStrokes, eraserRadius, extendStrokePath, strokeFromPath, STROKE_MIN_POINT_DISTANCE,
  type CanvasStroke, type DrawingPen,
} from '@/lib/canvasDrawing';
import { StrokeShapes } from './StrokeShapes';

export interface DrawingSurfaceProps {
  strokes: readonly CanvasStroke[];
  pen: DrawingPen;
  width: number;
  height: number;
  /** A finished stroke, as an EVENT: each caller applies it its own way (CRDT op, array update). */
  onStrokeAdded: (stroke: CanvasStroke) => void;
  /** The ids of strokes the eraser touched, as an event. Strokes need an `id` to be erasable. */
  onStrokesErased: (strokeIds: string[]) => void;
  readOnly?: boolean;
  ariaLabel: string;
  /** Shown while there is nothing drawn yet. */
  emptyHint?: string;
}

/**
 * A pointer-drawable SVG: records a path between pointer-down and pointer-up
 * (mouse, pen or touch), then turns it into a stroke with the SAME
 * `strokeFromPath` / `eraseStrokes` the canvas stage uses. Coordinates are in
 * the surface's own viewBox space, so a drawing scales with its container.
 *
 * Only the primary pointer draws (a second finger or a right click is ignored),
 * a cancelled gesture discards its stroke, and the in-progress stroke is painted
 * from a ref at most once per animation frame rather than through state per move.
 */
export function DrawingSurface({ strokes, pen, width, height, onStrokeAdded, onStrokesErased, readOnly, ariaLabel, emptyHint }: DrawingSurfaceProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<Array<{ x: number; y: number }>>([]);
  const activePointer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  // The in-progress stroke as of the last animation frame (the ref above is what the handlers append to).
  const [live, setLive] = useState<Array<{ x: number; y: number }>>([]);
  // How much the viewBox is shrunk on screen (a 640-wide drawing on a 360px phone is ~0.5).
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (svg.clientWidth > 0) setScale(Math.min(1, svg.clientWidth / width)); });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [width]);
  /** A size that stays ~readable on screen whatever the shrink, in viewBox units. */
  const readable = (screenPx: number) => screenPx / scale;

  const repaint = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; setLive(pathRef.current.slice()); });
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  const toPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const box = svgRef.current!.getBoundingClientRect();
    return {
      x: box.width ? ((event.clientX - box.left) / box.width) * width : 0,
      y: box.height ? ((event.clientY - box.top) / box.height) * height : 0,
    };
  };

  const release = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    activePointer.current = null;
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || activePointer.current !== null) return;
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    activePointer.current = event.pointerId;
    beginStrokePath(pathRef, toPoint(event));
    event.currentTarget.setPointerCapture(event.pointerId);
    repaint();
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || event.pointerId !== activePointer.current) return;
    extendStrokePath(pathRef, toPoint(event), STROKE_MIN_POINT_DISTANCE);
    repaint();
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || event.pointerId !== activePointer.current) return;
    extendStrokePath(pathRef, toPoint(event), STROKE_MIN_POINT_DISTANCE);
    const path = endStrokePath(pathRef);
    release(event);
    repaint();
    if (!path.length) return;
    if (pen.tool === 'eraser') {
      const kept = eraseStrokes(strokes, path, eraserRadius(pen.width));
      const ids = strokes.filter((stroke) => !kept.includes(stroke) && stroke.id).map((stroke) => stroke.id!);
      if (ids.length) onStrokesErased(ids);
      return;
    }
    const stroke = strokeFromPath(pen, path);
    if (stroke) onStrokeAdded(stroke);
  };
  /** A cancelled gesture (palm rejection, a system gesture) leaves no mark. */
  const onPointerCancel = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerId !== activePointer.current) return;
    endStrokePath(pathRef);
    release(event);
    repaint();
  };

  const preview = pen.tool === 'eraser' || !live.length ? null : strokeFromPath(pen, live);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      // touch-action:none so a finger draws instead of scrolling the page; no text selection while dragging.
      style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${width} / ${height}`, touchAction: readOnly ? 'auto' : 'none', userSelect: 'none', cursor: readOnly ? 'default' : 'crosshair', color: 'var(--text-primary)', background: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}
    >
      <StrokeShapes strokes={preview ? [...strokes, preview] : strokes} minTextSize={readable(12)} />
      {!strokes.length && !live.length && emptyHint && <text x={readable(12)} y={readable(28)} fill="var(--text-muted)" style={{ fontSize: readable(14) }}>{emptyHint}</text>}
    </svg>
  );
}

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { drawCad } from '@/lib/creation/cad/cadRenderer';
import { topmostShapeAt, type Point } from '@/lib/creation/cad/cadGeometry';
import { layerOf, type CadShape, type CadState } from '@/lib/creation/cad/cadState';
import { shapeFromDrag, snapPoint, type CadDrawTool, type CadTool } from '@/lib/creation/cad/cadTools';
import styles from './cadEditor.module.css';

/** Backing-store resolution: enough pixels that a sheet stays crisp when the card is wide, few enough to stay cheap. */
const TARGET_PIXEL_WIDTH = 1400;
const MAX_ZOOM = 6;
/** How far (CSS px) a tap may miss a line and still select it. */
const HIT_TOLERANCE_PX = 8;

export interface CadSheetProps {
  state: CadState;
  selection: readonly string[];
  tool: CadTool;
  /** Whether a drawing tool may draw. A viewer still selects. */
  editable: boolean;
  label: string;
  /** The theme's accent, for the selection outline. */
  selectionInk: string;
  /** Export palette roles `paper` and `gridLine`, resolved: the sheet is white paper in both themes. */
  paper: string;
  gridInk: string;
  onDraw: (shape: CadShape) => void;
  onSelect: (ids: readonly string[]) => void;
}

interface Drag { tool: CadDrawTool; start: Point; current: Point }

/**
 * The drawing sheet: a canvas scaled to the card's width, with pointer drawing.
 *
 * Presentational — it holds only the gesture in progress. What the gesture means lives
 * in `cadTools`, what is drawn in `cadRenderer`, and what is kept in `useCadEditor`.
 * Pointer events (not mouse) so a finger draws exactly as a mouse does, and the canvas
 * takes the pointer while a tool is active so a drag draws instead of panning the board.
 */
export function CadSheet({ state, selection, tool, editable, label, selectionInk, paper, gridInk, onDraw, onSelect }: CadSheetProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const zoom = Math.min(MAX_ZOOM, TARGET_PIXEL_WIDTH / state.widthMm);
  const drawing = tool !== 'select' && editable;
  const layer = layerOf(state, state.activeLayerName);
  const blocked = drawing && layer?.locked === true;

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const inFlight = drag ? shapeFromDrag(drag.tool, drag.start, drag.current, { layer: state.activeLayerName }, 'in-flight') : null;
    drawCad(context, state, { zoom, inFlight, selectedIds: selection, selectionInk, paper, gridInk });
  }, [state, zoom, drag, selection, selectionInk, paper, gridInk]);

  const toModel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): { point: Point; mmPerPixel: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      point: { x: ((event.clientX - box.left) / box.width) * state.widthMm, y: ((event.clientY - box.top) / box.height) * state.heightMm },
      mmPerPixel: state.widthMm / box.width,
    };
  }, [state.widthMm, state.heightMm]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const at = toModel(event);
    if (!at) return;
    if (tool === 'select') {
      const hit = topmostShapeAt(state, at.point, HIT_TOLERANCE_PX * at.mmPerPixel);
      // Shift/ctrl adds to the selection; a plain tap replaces it, and an empty tap clears it.
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      onSelect(hit ? (additive ? (selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id]) : [hit.id]) : additive ? selection : []);
      return;
    }
    if (!drawing || blocked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = snapPoint(state, at.point);
    setDrag({ tool, start: point, current: point });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const at = toModel(event);
    if (at) setDrag({ ...drag, current: snapPoint(state, at.point) });
  };

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>, commit: boolean) => {
    if (!drag) return;
    const at = commit ? toModel(event) : null;
    const end = at ? snapPoint(state, at.point) : drag.current;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const shape = commit ? shapeFromDrag(drag.tool, drag.start, end, { layer: state.activeLayerName }) : null;
    if (shape) onDraw(shape);
  };

  return <div className={`${styles.sheet} nodrag nopan nowheel`} data-tool={drawing ? tool : 'select'} data-blocked={blocked || undefined}>
    <canvas
      ref={canvasRef}
      className={styles.sheetCanvas}
      width={Math.round(state.widthMm * zoom)}
      height={Math.round(state.heightMm * zoom)}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
    />
  </div>;
}

import type { Edge, Node, ReactFlowInstance } from '@xyflow/react';
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { canvasLayoutViewport } from '@/lib/canvasGridFit';
import { CANVAS_FIT_MIN_ZOOM, canvasLayoutOrientation, cleanCanvasLayout } from './cleanCanvasLayout';

/**
 * The arrange command every canvas puts on its rail: lay the objects out for the
 * shape of THIS board, then frame the result.
 *
 * All five canvases had hand-copied the same three lines, all of them measuring
 * nothing — so "arrange" meant "lay out for a wide screen" even on a phone, and
 * the fit that followed stopped at the board's pinch floor with the board still
 * running off the side. Measuring and framing belong with the layout, once.
 */
export function useCanvasCleanLayout<NodeType extends Node, EdgeType extends Edge>({
  boardRef,
  instanceRef,
  setNodes,
  edges,
  padding = 0.18,
  maxZoom = 1,
}: {
  /** The element the board is drawn in — its shape decides which way the graph runs. */
  boardRef: { readonly current: HTMLElement | null };
  instanceRef: { readonly current: ReactFlowInstance<NodeType, EdgeType> | null };
  setNodes: Dispatch<SetStateAction<NodeType[]>>;
  /** Omit for a board with no connections — it lays out as a grid either way. */
  edges?: EdgeType[];
  padding?: number;
  maxZoom?: number;
}): () => void {
  return useCallback(() => {
    const box = boardRef.current?.getBoundingClientRect();
    const orientation = canvasLayoutOrientation(
      box?.width ?? (typeof window === 'undefined' ? 0 : window.innerWidth),
      box?.height ?? (typeof window === 'undefined' ? 0 : window.innerHeight),
    );
    // The board's width in FLOW coordinates — see `useCanvasLayoutViewport` for why
    // the zoom divides out. A budget in screen pixels would halve the number of
    // columns every time somebody zoomed out to see more of the board.
    const zoom = instanceRef.current?.getViewport?.().zoom;
    const scale = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const { width } = canvasLayoutViewport({
      boardWidth: box?.width ? box.width / scale : undefined,
      screenWidth: typeof window === 'undefined' ? undefined : window.innerWidth,
    });
    setNodes((current) => cleanCanvasLayout(current, edges ?? [], orientation, width));
    // Next frame: the fit has to read the positions we just set.
    window.setTimeout(() => void instanceRef.current?.fitView({ padding, maxZoom, minZoom: CANVAS_FIT_MIN_ZOOM, duration: 320 }), 0);
  }, [boardRef, instanceRef, setNodes, edges, padding, maxZoom]);
}

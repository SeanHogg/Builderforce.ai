// No 'use client' directive: a hook cannot run anywhere but a client component, and
// every importer already declares the boundary. Adding one here would only grow the
// architecture ratchet's client-component tally for a module that is not a component.
import { useCallback } from 'react';
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react';
import { canvasLayoutViewport, type CanvasLayoutViewport } from '@/lib/canvasGridFit';

/**
 * HOW MUCH BOARD THERE IS TO LAY OUT ON, measured at the moment somebody asks.
 *
 * Every canvas needs this answer and none of them could give it. The three
 * places that asked measured `window.innerWidth <= 760` and threw the width
 * away, so an authored object had no idea whether it had 360px or 3440px to be
 * placed in — which is why a batch of generated artifacts came out as one
 * column on an ultrawide screen.
 *
 * ── WHY IT IS A READER AND NOT A VALUE ───────────────────────────────────────
 * Returned as a function rather than as state, deliberately. The answer changes
 * on every resize and every zoom, and a value would either re-render the whole
 * board on both (this is the canvas host — that is expensive) or hand a layout a
 * measurement from whenever the last render happened. Callers hold one stable
 * reader and get today's number when they use it, which is also what lets it be
 * passed to `CanvasProposalStage`, an object that outlives many renders.
 *
 * ── WHY THE BOARD WIDTH IS DIVIDED BY THE ZOOM ───────────────────────────────
 * Objects are positioned in FLOW coordinates. A board 3440 screen-pixels wide at
 * 0.5 zoom is 6880 flow-pixels of room, and a budget in screen pixels would halve
 * the layout every time somebody zoomed out to see more of it.
 */
export function useCanvasLayoutViewport<NodeType extends Node, EdgeType extends Edge>({
  boardRef, instanceRef,
}: {
  /** The element the board is drawn in. Absent/unmounted falls back to the window. */
  boardRef: { readonly current: HTMLElement | null };
  /** React Flow, for the zoom that converts screen width into flow width. */
  instanceRef: { readonly current: ReactFlowInstance<NodeType, EdgeType> | null };
}): () => CanvasLayoutViewport {
  return useCallback(() => {
    const measured = boardRef.current?.getBoundingClientRect().width;
    const zoom = instanceRef.current?.getViewport?.().zoom;
    const scale = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    return canvasLayoutViewport({
      boardWidth: typeof measured === 'number' && measured > 0 ? measured / scale : undefined,
      screenWidth: typeof window === 'undefined' ? undefined : window.innerWidth,
    });
  }, [boardRef, instanceRef]);
}

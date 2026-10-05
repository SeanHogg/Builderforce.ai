import { createContext, useContext } from 'react';

/**
 * How much of the board each edge's Brain dock covers, in screen px.
 *
 * The stylesheet reads the same numbers as `--brain-dock-left/right` to push floating
 * chrome in. This is for the few things placed in FLOW coordinates, which a CSS variable
 * cannot reach: React Flow's pane runs under the dock, so "on screen" is the pane minus
 * these. `CanvasShell` publishes both from one reservation, so they cannot disagree.
 */
export interface CanvasDockInsets {
  left: number;
  right: number;
}

const NO_INSETS: CanvasDockInsets = { left: 0, right: 0 };

export const CanvasDockInsetsContext = createContext<CanvasDockInsets>(NO_INSETS);

export function useCanvasDockInsets(): CanvasDockInsets {
  return useContext(CanvasDockInsetsContext);
}

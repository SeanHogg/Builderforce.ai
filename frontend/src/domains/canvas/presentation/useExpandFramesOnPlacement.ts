// No 'use client': imported only into `CreationCanvas`'s client boundary.
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  expandFrames, framesToExpandOnPlacement, placementInFlight, type PlaceableNode, type ToFrameBox,
} from '../application/ExpandFramesOnPlacement';

export interface ExpandFramesOnPlacementOptions<N> {
  /** A node as the rectangle containment is decided from — the board's own `toFrameBox`.
   *  Pass a STABLE function (a module-level one): it is an effect dependency. */
  toBox: ToFrameBox<N>;
  /** This person may edit the board. A viewer's board is never rewritten locally. */
  enabled: boolean;
  /** True while an undo/redo is restoring a snapshot: that is history, not a placement.
   *  A ref rather than a callback so it is read at effect time, never during render. */
  suspended?: { readonly current: boolean };
}

/**
 * Wires "placing into a collapsed frame opens it" to a board's node state.
 *
 * Every change to the board — a drop, a paste, an import, an applied Brain change set,
 * an adopted collaborator board — is diffed against the board as it last SETTLED (a
 * drag in flight holds the baseline until it ends, so the whole gesture is one
 * placement). The expand goes back through the same setter as any edit, so it lands
 * in the same undo step as the placement (history settles on a debounce) and is saved
 * and synced by the same board diff. The first board this sees is the one it was
 * handed, not a placement — so loading a board with members already inside a collapsed
 * section opens nothing.
 */
export function useExpandFramesOnPlacement<N extends PlaceableNode>(
  nodes: readonly N[],
  setNodes: Dispatch<SetStateAction<N[]>>,
  { toBox, enabled, suspended }: ExpandFramesOnPlacementOptions<N>,
): void {
  const baseline = useRef<readonly N[] | null>(null);

  useEffect(() => {
    if (placementInFlight(nodes)) return;
    const before = baseline.current;
    baseline.current = nodes;
    if (!before || !enabled || suspended?.current) return;
    const frameIds = framesToExpandOnPlacement(before, nodes, toBox);
    if (frameIds.length === 0) return;
    setNodes((current) => expandFrames(current, frameIds, toBox));
  }, [enabled, nodes, setNodes, suspended, toBox]);
}

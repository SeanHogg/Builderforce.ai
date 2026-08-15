import type { ReactNode } from 'react';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';

/**
 * The ONE place that decides which runtime surface takes the centre of the canvas.
 *
 * ── WHY A ROUTER AND NOT AN INLINE BRANCH ────────────────────────────────────────
 * `CreationCanvas.tsx` is already the widest dispatch in the codebase. A second axis
 * spelled out there as `{surface === 'chat' && <Chat/>}{surface === 'scene3d' && …}`
 * would be a branch every future runtime has to remember to add itself to, in a file
 * nobody wants to open. Open/closed: the host is closed to modification and the map is
 * open to extension.
 *
 * ── WHY ReactNodes AND NOT COMPONENT TYPES ───────────────────────────────────────
 * Each runtime needs a props bundle only the host can assemble — the 3D scene wants the
 * projected nodes, the describe adapter and the move handler; chat wants the live
 * transcript, the trace and the guest wall. Teaching the router all of them would
 * re-couple it to every runtime, which is the coupling the seam exists to prevent. The
 * host assembles each surface once with its proper props; the router only picks.
 *
 * ── WHY `graph` IS NOT IN THE MAP ────────────────────────────────────────────────
 * The flat board is not an overlay — it is the React Flow tree the host renders
 * unconditionally, so that panning, the viewport and every node's state survive a trip
 * through another surface and back. A surface that replaces it says so with
 * `showsBoard: false`, which is what the stylesheet suppresses the board from. So the
 * router returns nothing for `graph`: there is nothing to put ON TOP of it.
 */
export type CanvasSurfaceNodes = Partial<Record<CanvasSurfaceId, ReactNode>>;

export interface CanvasSurfaceRouterProps {
  surface: CanvasSurfaceId;
  surfaces: CanvasSurfaceNodes;
}

/** Renders the active surface, or nothing when the board itself is the surface. */
export function CanvasSurfaceRouter({ surface, surfaces }: CanvasSurfaceRouterProps): ReactNode {
  return surfaces[surface] ?? null;
}

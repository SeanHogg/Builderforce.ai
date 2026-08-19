/**
 * How a React Flow board accepts a drawn connection — the ONE contract, as data.
 *
 * Every board here gives a node exactly two connection points: a `target` handle on the
 * left and a `source` handle on the right. React Flow's DEFAULT `ConnectionMode.Strict`
 * then reads those types literally — a drag that starts on a right-hand handle is only
 * valid if it ENDS on a left-hand one:
 *
 *   isValid = (fromTarget && droppedOn === 'source') || (!fromTarget && droppedOn === 'target')
 *
 * So dragging out of one card's right handle and dropping on the next card's right
 * handle silently does nothing. Nothing is disabled, nothing errors, the line just
 * vanishes on release — which reads as "connections are broken", because from the
 * outside a handle is a handle.
 *
 * `Loose` is the honest description of what these boards mean: a handle is a connection
 * point, and the DIRECTION comes from the drag (where you started is the source), not
 * from which side of the card you happened to release on. Loose still refuses the one
 * genuinely meaningless drop — back onto the handle you started from — and
 * `isValidConnection` below refuses the other one, a node wired to itself.
 *
 * The edge still RENDERS right-to-left: with no handle ids in play, React Flow resolves
 * an edge's target end to the node's first `target` handle, so arrows keep entering
 * cards on the left however the connection was drawn.
 *
 * Pure data + a pure predicate, so the rule is assertable without mounting a board —
 * the same reason `canvasPointerMode.ts` owns the pan/select contract.
 */
import { ConnectionMode, type Connection, type Edge } from '@xyflow/react';

/** Finger/stylus vs mouse/trackpad, as reported by `(pointer: coarse)`. */
export type FlowPointerKind = 'coarse' | 'fine';

/** The React Flow props this module owns, named exactly as React Flow names them. */
export type FlowConnectionProps = {
  connectionMode: ConnectionMode;
  /** Pixels around a handle within which a release still snaps to it. */
  connectionRadius: number;
  isValidConnection: (connection: Edge | Connection) => boolean;
};

/**
 * React Flow's default snap radius is 20px, which asks a mouse to land inside a target
 * the size of the dot itself. These are drop-forgiveness numbers, not hit-target
 * numbers — a release near the card's edge should find that card's handle.
 */
const FINE_CONNECTION_RADIUS = 32;
const COARSE_CONNECTION_RADIUS = 52;

/**
 * A connection with both ends on the same node. Loose mode already rejects a release on
 * the handle the drag started from, but not the OTHER handle of the same card, and a
 * card that references itself says nothing.
 */
export function isSelfConnection(connection: Edge | Connection): boolean {
  return Boolean(connection.source) && connection.source === connection.target;
}

/** The connection props for one pointer kind. */
export function flowConnectionProps(pointer: FlowPointerKind = 'fine'): FlowConnectionProps {
  return {
    connectionMode: ConnectionMode.Loose,
    connectionRadius: pointer === 'coarse' ? COARSE_CONNECTION_RADIUS : FINE_CONNECTION_RADIUS,
    isValidConnection: (connection) => !isSelfConnection(connection),
  };
}

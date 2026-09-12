/**
 * PLACING INTO A COLLAPSED FRAME OPENS IT — the board half of the rule.
 *
 * The rule itself (which frames, and which to leave alone) is
 * `framesToExpandForPlacement` in the domain. This module answers the two questions
 * that rule cannot: WHAT was placed, given two versions of the board, and what the
 * expand looks like as a board edit.
 *
 * ── WHY IT READS THE BOARD STATE AND NOT EACH PLACEMENT PATH ────────────────
 * Objects reach the board by a user drop, a drag, a paste, a file import, an
 * applied Brain change set (canvas_* tools stage into `CanvasProposalStage`, the
 * review step applies), a collaborator's board being adopted and a guest-room
 * snapshot. Those are seven call sites with seven shapes, and the one thing they
 * share is the board they write. Diffing the board is the only hook point every
 * path goes through — including the next one somebody adds — so the rule is applied
 * there, once, rather than remembered at each site.
 *
 * The expand is written into the same board state a manual expand writes, through
 * {@link withFrameCollapsed} (which the card's own collapse toggle also uses), so
 * it is undone by undo and saved and synced by the same diff as every other edit.
 */

import { frameCollapsePatch, framesToExpandForPlacement, isFrame, isFrameCollapsed, type FrameBox } from '../domain/canvasFrame';

/** The part of a board node this rule reads. A React Flow node satisfies it. */
export interface PlaceableNode {
  id: string;
  position: { x: number; y: number };
  style?: object;
  data: unknown;
  /** Set by the graph library while a drag is in flight and cleared when it ends. */
  dragging?: boolean;
}

/** A node as the rectangle containment is decided from (a collapsed frame at its OPEN size). */
export type ToFrameBox<N> = (node: N) => FrameBox;

/**
 * A drag has not finished placing anything. While one is in flight the object only
 * PASSES OVER sections; opening every chip it crossed would be the board jumping
 * around under the pointer. The caller holds its baseline until the drag ends and
 * diffs the whole gesture at once.
 */
export function placementInFlight(nodes: readonly PlaceableNode[]): boolean {
  return nodes.some((node) => node.dragging === true);
}

/** Objects that are new on the board, or stand somewhere else than they did. */
export function placedObjectIds(before: readonly PlaceableNode[], after: readonly PlaceableNode[]): string[] {
  const previous = new Map(before.map((node) => [node.id, node.position]));
  return after
    .filter((node) => {
      const was = previous.get(node.id);
      return !was || was.x !== node.position.x || was.y !== node.position.y;
    })
    .map((node) => node.id);
}

/** The collapsed frames the change from `before` to `after` placed something into. */
export function framesToExpandOnPlacement<N extends PlaceableNode>(
  before: readonly N[],
  after: readonly N[],
  toBox: ToFrameBox<N>,
): string[] {
  const placed = placedObjectIds(before, after);
  if (placed.length === 0) return [];
  return framesToExpandForPlacement(before.map(toBox), after.map(toBox), placed);
}

/**
 * A frame put away or opened, as a node. Size lives on the node (its style) and the
 * remembered authored size in its data, so both move together — the one piece of
 * code that writes `frameExpandedWidth/Height`, whether a person, Brain or this rule
 * toggled it. `box` is the frame as measured NOW (collapsing records its drawn size).
 */
export function withFrameCollapsed<N extends PlaceableNode>(node: N, collapsed: boolean, box: FrameBox): N {
  const collapse = frameCollapsePatch(box, collapsed);
  return {
    ...node,
    style: { ...node.style, ...collapse.size },
    data: { ...(node.data as object), ...collapse.data },
  } as N;
}

/**
 * Open these frames on the board. A frame that is already open (a collaborator got
 * there first, or the frame was deleted) is left alone, and a board with nothing to
 * open is returned as the SAME array so the state setter does not re-render.
 */
export function expandFrames<N extends PlaceableNode>(board: N[], frameIds: readonly string[], toBox: ToFrameBox<N>): N[] {
  const open = new Set(frameIds);
  let changed = false;
  const next = board.map((node) => {
    if (!open.has(node.id)) return node;
    const box = toBox(node);
    if (!isFrame(box) || !isFrameCollapsed(box.data)) return node;
    changed = true;
    return withFrameCollapsed(node, false, box);
  });
  return changed ? next : board;
}

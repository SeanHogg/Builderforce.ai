// No 'use client': imported only into `CreationCanvas`'s client boundary.
import { useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import {
  frameMemberIds, hiddenByCollapsedFrames, isFrame, visibleEndpoint, type FrameBox,
} from '@/domains/canvas/domain/canvasFrame';
import { canvasNodeDimensions } from './creationCanvasLayout';
import type { CreationFlowNode } from './CreationNode';

/**
 * THE BOARD, AS FRAMED — what is on screen once frames are taken seriously.
 *
 * Two questions, both about containment, both answered here so the canvas does not
 * grow a third and a fourth copy of the containment rule:
 *
 *  • A COLLAPSED frame hides what it holds, and a connection into or out of that
 *    section re-points at the frame itself. A flow whose middle was put away must
 *    still read as one flow — an edge that simply vanished with its endpoint reads
 *    as a flow that stops there, which is worse than not collapsing at all.
 *
 *  • A FOCUSED frame shows only what it holds. That is the canvas within a canvas:
 *    the same board, the same objects, the same connections, at the size of a
 *    screen instead of the size of the board. It is what replaced the modal
 *    workflow editor, which was a SECOND canvas with its own palette, node renderer
 *    and selection model, drawn over a board that already had all three.
 *
 * Hidden rather than filtered out: React Flow keeps a hidden node's identity, so a
 * selection, an in-flight edit and the undo stack survive a collapse. Dropping the
 * nodes from the array would make collapsing a frame indistinguishable from deleting
 * its contents as far as everything downstream is concerned.
 *
 * A hook and not a branch inside the canvas: it is one rule with one reason to
 * change, it is memoized on exactly what it reads, and any second board that grows
 * frames gets it for free.
 */

export interface FramedBoard {
  nodes: CreationFlowNode[];
  edges: Edge[];
  /** Every object on the board as a rectangle — what containment is decided from. */
  boxes: FrameBox[];
  /** What a frame currently holds, at any depth. Empty for anything else. */
  memberIdsOf: (frameId: string) => string[];
}

/**
 * A node as a rectangle.
 *
 * Exported because containment is asked in two places — here, to decide what is drawn,
 * and by the frame's own inspector, to say what it holds — and a second mapping from
 * node to rectangle is a second answer to "is this inside that".
 *
 * A COLLAPSED frame is measured at the size it had before it was put away, because
 * containment has to keep meaning what it meant: measuring the chip would find
 * nothing inside it, and everything the frame holds would silently escape it the
 * moment it was closed — which is the one state where the relationship matters most.
 */
export function toFrameBox(node: CreationFlowNode): FrameBox {
  const measured = canvasNodeDimensions(node);
  // Same tolerance as `useFrameMemberCount`: containment is a reading of the board, and
  // a node caught mid-transition without `data` must not take the render with it.
  const data = (node.data ?? {}) as CreationFlowNode['data'];
  const collapsed = isFrame({ kind: data.kind }) && data.frameCollapsed === true;
  const width = Number(data.frameExpandedWidth);
  const height = Number(data.frameExpandedHeight);
  return {
    id: node.id,
    kind: data.kind,
    position: node.position,
    size: {
      width: collapsed && width > 0 ? width : measured.width,
      height: collapsed && height > 0 ? height : measured.height,
    },
    data: data as unknown as Record<string, unknown>,
  };
}

export function useFramedBoard(
  nodes: CreationFlowNode[],
  edges: Edge[],
  /** The frame being worked on alone, or null for the whole board. */
  focusFrameId: string | null,
): FramedBoard {
  const boxes = useMemo(() => nodes.map(toFrameBox), [nodes]);
  const hidden = useMemo(() => hiddenByCollapsedFrames(boxes), [boxes]);
  const focusMembers = useMemo(
    () => (focusFrameId ? new Set([focusFrameId, ...frameMemberIds(focusFrameId, boxes)]) : null),
    [boxes, focusFrameId],
  );

  const framedNodes = useMemo(() => nodes.map((node) => {
    const away = hidden.has(node.id) || (focusMembers !== null && !focusMembers.has(node.id));
    return away && node.hidden !== true ? { ...node, hidden: true } : node;
  }), [focusMembers, hidden, nodes]);

  const framedEdges = useMemo(() => {
    // Two steps inside one put-away section that both feed the same downstream step
    // collapse to the SAME chip-to-step connection. Drawn twice they are two identical
    // arrows stacked on each other, and clicking one selects whichever React Flow put
    // on top — so the second is dropped rather than rendered invisibly.
    const drawn = new Set<string>();
    return edges.flatMap((edge) => {
      const source = visibleEndpoint(edge.source, boxes, hidden);
      const target = visibleEndpoint(edge.target, boxes, hidden);
      // Both ends inside the SAME put-away section: the connection is internal to
      // something nobody is looking at, so there is nothing to draw. Left in place it
      // would be a self-loop on the chip.
      if (source === target) return [];
      if (source === edge.source && target === edge.target) return [edge];
      const signature = `${source}->${target}`;
      if (drawn.has(signature)) return [];
      drawn.add(signature);
      return [{
        ...edge,
        source,
        target,
        // The outlet belonged to the step, not to the chip standing in for it.
        sourceHandle: source === edge.source ? edge.sourceHandle : null,
        targetHandle: target === edge.target ? edge.targetHandle : null,
      }];
    });
  }, [boxes, edges, hidden]);

  return useMemo(() => ({
    nodes: framedNodes,
    edges: framedEdges,
    boxes,
    memberIdsOf: (frameId: string) => frameMemberIds(frameId, boxes),
  }), [boxes, framedEdges, framedNodes]);
}

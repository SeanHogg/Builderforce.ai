'use client';

import type { ComponentType } from 'react';
import type { Node, NodeProps, NodeTypes } from '@xyflow/react';

/**
 * An object drawn by the SAME component the board draws it with, off the board.
 *
 * A second renderer for "what does this object look like" is a second answer that
 * drifts: the 3D space used to summarise every object as a title, a status and a
 * badge, so a website read "Draft" in 3D while the board showed its page. Handing
 * the board's own `nodeTypes` here makes the two readings one component.
 *
 * Board state the node component reads (`useStore`) comes from the host's
 * `ReactFlowProvider`, which wraps both readings. What React Flow's node wrapper
 * would add is answered for a face that is looked at, not worked on: never
 * selected (the host draws its own selection), never dragged, never connected —
 * see `CanvasNodeHandle` for the connection points.
 */
export function CanvasNodeFace<N extends Node>({ node, nodeTypes }: { node: N; nodeTypes: NodeTypes }) {
  const Face = nodeTypes[node.type ?? 'default'] as ComponentType<NodeProps<N>> | undefined;
  if (!Face) return null;
  const width = node.measured?.width ?? node.width;
  const height = node.measured?.height ?? node.height;
  const props = {
    id: node.id,
    data: node.data,
    type: node.type,
    selected: false,
    dragging: false,
    draggable: false,
    selectable: false,
    deletable: false,
    isConnectable: false,
    zIndex: 0,
    positionAbsoluteX: node.position.x,
    positionAbsoluteY: node.position.y,
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    ...(node.sourcePosition ? { sourcePosition: node.sourcePosition } : {}),
    ...(node.targetPosition ? { targetPosition: node.targetPosition } : {}),
    ...(node.dragHandle ? { dragHandle: node.dragHandle } : {}),
    ...(node.parentId ? { parentId: node.parentId } : {}),
  } as NodeProps<N>;
  return <Face {...props} />;
}

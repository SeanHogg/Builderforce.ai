'use client';

import { Handle, useNodeId, type HandleProps } from '@xyflow/react';

/**
 * A node's connection point, wherever the node is drawn.
 *
 * On the board React Flow wraps every node in its own id context, and this is
 * exactly its `Handle`. The same card drawn as an object's face somewhere else —
 * the 3D space draws each object with the board's own component — has no node
 * wrapper around it, and xyflow's `Handle` reports the missing id through the
 * board's `onError` (the creation canvas turns that into a notice). There the
 * handle is only its picture: the same classes, so the card looks the same, and
 * nothing to connect.
 */
export function CanvasNodeHandle(props: HandleProps) {
  const nodeId = useNodeId();
  if (nodeId) return <Handle {...props} />;
  const { position, className, style } = props;
  return <div
    aria-hidden
    className={`react-flow__handle react-flow__handle-${position}${className ? ` ${className}` : ''}`}
    {...(style ? { style } : {})}
  />;
}

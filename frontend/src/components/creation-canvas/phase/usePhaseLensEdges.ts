import { useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import { useCanvasPhase } from './CanvasPhaseContext';
import { phaseFocusOf } from '@/lib/canvasPhaseLens';
import styles from '../CreationCanvas.module.css';

/**
 * The phase lens, applied to CONNECTIONS: an edge between two cards the phase is not
 * about recedes with them. Computed where the board's edges are handed to React Flow,
 * never inside a card — a node knows its own kind, not both ends of every line.
 *
 * An edge that touches even one card in focus stays at full strength: it is how that
 * card relates to the rest of the board, which is exactly what the phase is reading.
 * Returns the input array untouched when the lens is off, so React Flow sees no change.
 */
export function usePhaseLensEdges(nodes: ReadonlyArray<{ id: string; data: { kind: string } }>, edges: Edge[]): Edge[] {
  const phaseValue = useCanvasPhase();
  const phase = phaseValue?.focusEnabled ? phaseValue.phase : null;
  return useMemo(() => {
    if (!phase) return edges;
    const outIds = new Set(nodes.filter((node) => phaseFocusOf(node.data.kind, phase) === 'out').map((node) => node.id));
    if (!outIds.size) return edges;
    return edges.map((edge) => (outIds.has(edge.source) && outIds.has(edge.target)
      ? { ...edge, className: edge.className ? `${edge.className} ${styles.edgeOut}` : styles.edgeOut }
      : edge));
  }, [edges, nodes, phase]);
}

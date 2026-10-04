import type { Edge, Node } from '@xyflow/react';
import { canvasGridColumns, DEFAULT_CANVAS_LAYOUT_WIDTH } from '@/lib/canvasGridFit';
import { canvasNodeFootprint, graphLayerRanks } from '@/lib/canvas/canvasGraph';

/**
 * Which way a board's dependency layers run: across a wide board, DOWN a tall
 * one. A phone is the tall one — a layered graph laid out left-to-right there is
 * several screens wide before the first fit, which is what made "arrange" hand
 * back a board you then had to go looking for.
 */
export type CanvasLayoutOrientation = 'horizontal' | 'vertical';

/** The orientation a board of this shape should be arranged for. */
export function canvasLayoutOrientation(width: number, height: number): CanvasLayoutOrientation {
  // Only a decisively tall board turns the graph; a near-square one keeps the
  // left-to-right reading order that matches the arrows drawn between nodes.
  return width > 0 && height > width * 1.15 ? 'vertical' : 'horizontal';
}

/**
 * Deterministically spaces nodes into graph layers, or a compact grid when there
 * are no connections. Shares its layering with the 3D view (see `canvasGraph`),
 * so arranging the board and tilting it tell the same story about dependencies.
 *
 * `orientation` is the axis the LAYERS advance on; nodes within a layer always
 * spread along the other one. Callers get it from `canvasLayoutOrientation` (or
 * from `useCanvasCleanLayout`, which measures the board for them).
 */
export function cleanCanvasLayout<T extends Node>(
  nodes: T[],
  edges: Edge[],
  orientation: CanvasLayoutOrientation = 'horizontal',
  availableWidth = DEFAULT_CANVAS_LAYOUT_WIDTH,
): T[] {
  if (nodes.length < 2) return nodes;
  const horizontalGap = 88;
  const verticalGap = 64;
  const vertical = orientation === 'vertical';
  const { ranks, connected } = graphLayerRanks(nodes, edges);

  if (!connected) {
    // FITTED to the board, not to the object count. This was `ceil(sqrt(n))` —
    // twelve unconnected objects became four columns on a phone and four columns
    // on a 3440px ultrawide, which is how "arrange" managed to hand back a tall
    // block with two thirds of the screen empty beside it. A tall board still
    // narrows (a layered graph laid out for width there is several screens wide
    // before the first fit), so the orientation keeps its say.
    const widest = Math.max(...nodes.map((node) => canvasNodeFootprint(node).width));
    const fitted = canvasGridColumns({ available: availableWidth, columnWidth: widest, gap: horizontalGap, count: nodes.length });
    const columns = Math.max(1, vertical ? Math.round(fitted / 1.6) : fitted);
    const columnWidths = Array.from({ length: columns }, () => 0);
    const rowHeights: number[] = [];
    nodes.forEach((node, index) => {
      const size = canvasNodeFootprint(node);
      const column = index % columns;
      const row = Math.floor(index / columns);
      columnWidths[column] = Math.max(columnWidths[column], size.width);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, size.height);
    });
    const xs = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((sum, width) => sum + width + horizontalGap, 0));
    const ys = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((sum, height) => sum + height + verticalGap, 0));
    return nodes.map((node, index) => ({ ...node, position: { x: xs[index % columns], y: ys[Math.floor(index / columns)] } }));
  }

  const layers = new Map<number, T[]>();
  for (const node of nodes) layers.set(ranks.get(node.id) ?? 0, [...(layers.get(ranks.get(node.id) ?? 0) ?? []), node]);
  const orderedLayers = [...layers.entries()].sort(([a], [b]) => a - b);
  const positions = new Map<string, { x: number; y: number }>();
  // `cross` walks the axis the layers advance on, `along` the axis they spread on.
  let cross = 0;
  for (const [, layerNodes] of orderedLayers) {
    let along = 0;
    let thickness = 0;
    for (const node of layerNodes) {
      const size = canvasNodeFootprint(node);
      positions.set(node.id, vertical ? { x: along, y: cross } : { x: cross, y: along });
      along += vertical ? size.width + horizontalGap : size.height + verticalGap;
      thickness = Math.max(thickness, vertical ? size.height : size.width);
    }
    cross += thickness + (vertical ? verticalGap : horizontalGap);
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}

/**
 * The zoom floor a FIT is allowed to reach, well below the floor a board sets for
 * pinching. A phone screen is a fraction of the width an arranged graph needs, and
 * a fit that stops at the pinch floor leaves most of the board off-screen — which
 * is not a fit, it is a crop. Pinching keeps the board's own (higher) floor so a
 * user cannot strand themselves in an unreadable view.
 */
export const CANVAS_FIT_MIN_ZOOM = 0.08;

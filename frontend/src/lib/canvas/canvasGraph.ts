/**
 * Geometry and layering primitives shared by every spatial canvas.
 *
 * Both the 2D "clean layout" command and the 3D view answer the same two
 * questions — how big is a card, and how deep is it in the dependency graph —
 * so they read the answers from here instead of each keeping their own copy.
 * A divergence between them would show as objects that sit in one order when
 * arranged and a different order when tilted, which reads as a bug in the data
 * rather than in the layout.
 */

/** The subset of a React Flow node these primitives actually need. */
export interface CanvasGraphNode {
  id: string;
  measured?: { width?: number; height?: number } | undefined;
  width?: number | undefined;
  height?: number | undefined;
  style?: { width?: unknown; height?: unknown } | undefined;
}

export interface CanvasGraphEdge {
  source: string;
  target: string;
}

export const CANVAS_DEFAULT_NODE_WIDTH = 260;
export const CANVAS_DEFAULT_NODE_HEIGHT = 150;

/**
 * The rendered footprint of a node, preferring what React Flow measured.
 *
 * Falls back through the explicit width/height and the style block before the
 * defaults, so a card that has not been measured yet (a node authored this tick,
 * or any node under jsdom) still contributes a realistic rectangle.
 */
export function canvasNodeFootprint(node: CanvasGraphNode): { width: number; height: number } {
  const styledWidth = typeof node.style?.width === 'number' ? node.style.width : undefined;
  const styledHeight = typeof node.style?.height === 'number' ? node.style.height : undefined;
  return {
    width: node.measured?.width ?? node.width ?? styledWidth ?? CANVAS_DEFAULT_NODE_WIDTH,
    height: node.measured?.height ?? node.height ?? styledHeight ?? CANVAS_DEFAULT_NODE_HEIGHT,
  };
}

export interface CanvasGraphLayering {
  /** Layer index per node id. 0 means "nothing upstream of this". */
  ranks: ReadonlyMap<string, number>;
  /** Distinct layers present, always at least 1 for a non-empty graph. */
  layerCount: number;
  /** False when no edge joins two of these nodes, so callers can fall back to a grid. */
  connected: boolean;
}

/**
 * Longest-path layering: every node sits one layer deeper than its deepest source.
 *
 * Edges that point outside this node set, or a node at itself, are ignored — a
 * canvas is routinely rendered as a subset (a frame, a selection) and those
 * dangling references must not silently drop a node out of the layering.
 * Nodes inside a cycle are never reached by the topological sweep, so each gets
 * its own trailing layer instead of collapsing into a pile at layer 0.
 */
export function graphLayerRanks(nodes: readonly CanvasGraphNode[], edges: readonly CanvasGraphEdge[]): CanvasGraphLayering {
  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  if (!nodes.length) return { ranks, layerCount: 0, connected: false };

  const ids = new Set(nodes.map((node) => node.id));
  const usableEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);
  if (!usableEdges.length) return { ranks, layerCount: 1, connected: false };

  const successors = new Map<string, string[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of usableEdges) {
    successors.set(edge.source, [...(successors.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    visited.add(id);
    for (const target of successors.get(id) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(id) ?? 0) + 1));
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }

  let cycleRank = Math.max(...ranks.values()) + 1;
  for (const node of nodes) if (!visited.has(node.id)) ranks.set(node.id, cycleRank++);

  return { ranks, layerCount: new Set(ranks.values()).size, connected: true };
}

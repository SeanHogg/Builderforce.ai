/**
 * graphLayout — the pure, framework-free half of every directed-graph view.
 *
 * WHY THIS IS ONE MODULE. `components/pm/DependencyGraph.tsx` had grown a private
 * longest-path `layout()` and a private `cycleEdgeKeys()`, both operating on task
 * ids and both entangled with React Flow's coordinate space. The moment a SECOND
 * graph surface appeared (the incident RCA topology in `components/charts/`), that
 * private copy became the first of N: same algorithm, different id type, and
 * nothing keeping the two agreeing about what "layer" or "cycle" means. So the
 * graph maths lives here, on plain string ids, and the components own only pixels.
 *
 * WHAT IT GUARANTEES, and why each one is load-bearing:
 *
 *  • TERMINATION ON CYCLES. Kahn's algorithm simply stops when every remaining node
 *    has an incoming edge, and a naive "keep relaxing until stable" pass over a
 *    cyclic graph never returns — a hung render on data the API tries to prevent but
 *    legacy rows still contain. Leftovers are placed deterministically after the
 *    acyclic core instead (see {@link layoutDag}).
 *  • DETERMINISM. Layer and row are derived from INPUT ORDER for ties, never from
 *    Map iteration of a set built elsewhere, so the same data draws the same picture
 *    on every render and a snapshot test is meaningful.
 *  • BACK EDGES ARE NAMED. An edge that points to a layer at or before its source is
 *    returned in `backEdges` so the renderer can draw it distinctly. Drawn like any
 *    other edge it reads as a normal dependency pointing backwards, which is exactly
 *    the misreading that lets a real cycle sit unnoticed in the data.
 */

export interface GraphNodeRef {
  id: string;
}

export interface GraphEdgeRef {
  from: string;
  to: string;
}

/** A node's place in the layered grid. `layer` is the causal depth, `row` its slot. */
export interface LayoutPosition {
  id: string;
  layer: number;
  row: number;
}

export interface GraphLayout {
  positions: LayoutPosition[];
  byId: Map<string, LayoutPosition>;
  /** Number of layers (columns) — 0 for an empty graph. */
  layerCount: number;
  /** How many nodes landed in each layer, indexed by layer. */
  rowsPerLayer: number[];
  /** The widest layer — what a renderer must size the cross-axis for. */
  maxRows: number;
  /** `edgeKey(from,to)` for every edge that points at or behind its own layer. */
  backEdges: Set<string>;
}

/** The canonical identity of an edge in the returned sets. */
export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * Layer a directed graph by LONGEST PATH from the roots, then pack each layer's
 * nodes into rows in input order.
 *
 * Longest path rather than shortest: a node must be drawn after everything that can
 * reach it, or an edge visibly points backwards even though the graph is acyclic.
 *
 * Edges naming an unknown node are ignored rather than treated as an error — a graph
 * is routinely built from a capped slice of a larger data set, and the alternative is
 * a view that renders nothing whenever a related row fell outside the cap.
 */
export function layoutDag(
  nodes: readonly GraphNodeRef[],
  edges: readonly GraphEdgeRef[],
): GraphLayout {
  const known = new Set(nodes.map((n) => n.id));
  const real = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);

  const successors = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n.id, 0);
  for (const e of real) {
    const list = successors.get(e.from);
    if (list) list.push(e.to);
    else successors.set(e.from, [e.to]);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const remaining = new Map(indegree);
  // Seeded in input order, and appended to in input order, so ties resolve the same
  // way on every run.
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const settled = new Set<string>(queue);
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    for (const next of successors.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
      const left = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, left);
      if (left === 0 && !settled.has(next)) { settled.add(next); queue.push(next); }
    }
  }

  // Whatever Kahn could not settle is inside (or downstream of) a cycle. Place it in
  // ONE pass, in input order, just past the deepest predecessor placed SO FAR —
  // bounded work, stable output, and no possibility of spinning on the cycle itself.
  //
  // "So far" is what makes a 2-cycle draw as a→b with one arrow coming back, rather
  // than as two nodes stacked in layer 0 with two arrows between them and no reading
  // order at all. Exactly one edge of the cycle then lands in `backEdges`, which is
  // the one the renderer should mark.
  const placed = new Set(settled);
  for (const n of nodes) {
    if (placed.has(n.id)) continue;
    let deepest = -1;
    for (const e of real) {
      if (e.to !== n.id) continue;
      if (!placed.has(e.from)) continue;
      deepest = Math.max(deepest, layer.get(e.from) ?? 0);
    }
    layer.set(n.id, deepest + 1);
    placed.add(n.id);
  }

  const rowsPerLayer: number[] = [];
  const positions: LayoutPosition[] = [];
  const byId = new Map<string, LayoutPosition>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const row = rowsPerLayer[l] ?? 0;
    rowsPerLayer[l] = row + 1;
    const pos = { id: n.id, layer: l, row };
    positions.push(pos);
    byId.set(n.id, pos);
  }
  for (let i = 0; i < rowsPerLayer.length; i += 1) if (rowsPerLayer[i] === undefined) rowsPerLayer[i] = 0;

  const backEdges = new Set<string>();
  for (const e of real) {
    if ((layer.get(e.to) ?? 0) <= (layer.get(e.from) ?? 0)) backEdges.add(edgeKey(e.from, e.to));
  }

  return {
    positions,
    byId,
    layerCount: rowsPerLayer.length,
    rowsPerLayer,
    maxRows: rowsPerLayer.reduce((a, b) => Math.max(a, b), 0),
    backEdges,
  };
}

/**
 * The edges that actually lie ON a cycle: `to` can already reach `from`.
 *
 * Distinct from {@link GraphLayout.backEdges}, which is a LAYOUT fact (this arrow
 * points leftwards in the drawing). An edge can be a back edge without being part of
 * a cycle, and the two are used for different things: the layout set decides how to
 * draw, this set decides what to warn about. Conflating them either cries cycle at a
 * legal graph or stays silent on a real one.
 */
export function cycleEdges(edges: readonly GraphEdgeRef[]): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from);
    if (list) list.push(e.to);
    else adjacency.set(e.from, [e.to]);
  }
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>([from]);
    const queue = [from];
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]!;
      if (current === target) return true;
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    return false;
  };
  const found = new Set<string>();
  for (const e of edges) if (reaches(e.to, e.from)) found.add(edgeKey(e.from, e.to));
  return found;
}

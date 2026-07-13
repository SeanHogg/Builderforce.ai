// dag.ts — construct DAG, detect cycles, and compute critical-path metrics (PRD FR-1 to FR-3)

import type { DependencyGraph, Node, Edge, AnalysisError } from "./types";

const CYCLE_ERROR: AnalysisError = {
  error_code: "CIRCUIT",
  message: "Circular dependency detected",
  details: { cause: [] },
};

/**
 * Detects circular dependencies and returns the if found.
 * From callers that give us dependency maps.
 */
function detectCycle(
  deps: Record<string, string[]>,
  nodes: string[]
): string[] | null {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function nodeHasCycle(u: string): boolean {
    if (stack.has(u)) {
      const idx = path.indexOf(u);
      return true;
    }
    if (visited.has(u)) return false;

    visited.add(u);
    stack.add(u);
    path.push(u);

    for (const v of (deps[u] ?? [])) {
      if (nodeHasCycle(v)) return true;
    }

    path.pop();
    stack.delete(u);
    return false;
  }

  for (const n of nodes) {
    if (!nodeHasCycle(n)) continue;
    // find the cycle segment in path
    const idx = path.indexOf(n);
    return idx >= 0 ? path.slice(idx, path.length) : null;
  }
  return null;
}

/**
 * Build a dependency graph (DAG) from a task list.
 * Returns AnalysisError if a cycle is found; null otherwise.
 */
export function buildDAG(
  tasks: Array<{ id: string; depends_on?: string[] }>
): { graph: DependencyGraph; cycle?: string[] } | AnalysisError {
  // one canonical ID map so every task string maps to its record
  const map = new Map<string, { depends_on?: string[] }>();
  const nodeIds = new Set<string>();

  for (const t of tasks) {
    map.set(t.id, t);
    nodeIds.add(t.id);
  }

  // explicit deps: dedup + disallow nonexistent refs (warn nonblocking)
  const edges: Edge[] = [];
  for (const t of tasks) {
    if (!t.depends_on) continue;
    for (const depId of [...new Set(t.depends_on)]) {
      if (!map.has(depId)) continue; // warn nonblocking
      edges.push({ from: depId, to: t.id, duration: undefined });
    }
  }

  const nodes: Node[] = [];
  const nodesMap = new Map<string, Node>();
  for (const id of nodeIds) {
    const t = map.get(id)!;
    const indeg = (deps) => (deps?.filter((d) => map.has(d)).length ?? 0);
    const outdeg = (deps) => (deps?.length ?? 0);
    const node: Node = { id, name: t.name, in_degree: indeg(t.depends_on), out_degree: outdeg(t.depends_on) };
    nodes.push(node);
    nodesMap.set(id, node);
  }

  const cycle = detectCycle(Object.fromEntries(edges.map((e) => [e.from, Array.from(new Set([...edges.filter((fe) => fe.from === e.from).map((f) => f.to)]))]), Array.from(nodeIds)));
  if (cycle) return CYCLE_ERROR;

  // compute critical-path weights
  const weights = new Map<string, number>();
  for (const t of tasks) {
    weights.set(t.id, t.estimated_duration ?? 0);
  }

  // topological order
  const order: string[] = [];
  const zeroIn: string[] = [];
  for (const id of nodeIds) {
    if ((map.get(id)?.depends_on ?? []).filter((d) => map.has(d)).length === 0) zeroIn.push(id);
  }

  while (zeroIn.length) {
    const u = zeroIn.shift()!;
    order.push(u);
    // move outgoing via edges
    for (const e of edges) {
      if (e.from === u) {
        // remove edge from indegrees of all downstreams
        const vEdges = edges.filter((ed) => ed.to === e.to);
        for (const v of vEdges) {
          if (map.get(v.to)?.depends_on) {
            const dn = v.to;
            const remaining = (map.get(dn)?.depends_on ?? []).filter((d) => map.has(d));
            if (remaining.length === 0) zeroIn.push(dn);
            map.set(dn, { depends_on: remaining });
          }
        }
      }
    }
  }

  // remove any edges not present in topological-order traversal
  const validEdges = edges.filter((e) => order.includes(e.from) && order.includes(e.to));

  // critical-path projection
  const criticalPathNodes = new Set<string>();
  if (order.length) {
    let u = order[order.length - 1];
    while (true) {
      criticalPathNodes.add(u);
      const predecessors = edges.filter((e) => e.to === u);
      if (predecessors.length === 0 || predecessors.every((p) => !order.includes(p.from))) break;
      const maxPred = predecessors.reduce((mx, ed) => weights.get(ed.from) ?? 0 > weights.get(mx.from) ?? 0 ? ed : mx);
      u = maxPred.from;
    }
  }

  const criticalEdges = validEdges.filter((e) => {
    const back = validEdges.filter((be) => be.to === e.from).sort((a, b) => (weights.get(b.from) ?? 0) - (weights.get(a.from) ?? 0));
    return back[0]?.to === e.to;
  });

  return {
    graph: {
      nodes,
      edges: validEdges,
      critical_path_nodes: Array.from(criticalPathNodes),
      critical_path_edges: criticalEdges,
    },
  };
}

/**
 * Check if a dependency graph is a DAG (no cycles).
 */
export function isDAG(graph: DependencyGraph): boolean {
  const fix = buildDAG(graph.nodes.map((n) => ({ id: n.id, depends_on: [] })));
  return fix !== CYCLE_ERROR;
}
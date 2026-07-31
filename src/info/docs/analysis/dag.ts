// dag.ts — construct DAG, detect cycles, compute critical path (PRD FR-2)

import type { DependencyGraph, Node, Edge, AnalysisError, TaskInput } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Adjacency {
  successors: Map<string, string[]>;   // node → nodes that depend on it
  predecessors: Map<string, string[]>; // node → nodes it depends on
}

function buildAdjacency(tasks: TaskInput[]): Adjacency {
  const ids = new Set(tasks.map((t) => t.id));
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();

  for (const t of tasks) {
    if (!successors.has(t.id)) successors.set(t.id, []);
    if (!predecessors.has(t.id)) predecessors.set(t.id, []);

    for (const dep of t.depends_on ?? []) {
      if (!ids.has(dep)) continue; // skip unknown refs (caller validates)
      // dep → t.id: dep must finish before t.id
      predecessors.get(t.id)!.push(dep);
      if (!successors.has(dep)) successors.set(dep, []);
      successors.get(dep)!.push(t.id);
    }
  }

  return { successors, predecessors };
}

// ---------------------------------------------------------------------------
// Cycle detection (FR-2.2): DFS with white/gray/black coloring
// Returns the cycle path `[first, ..., first]` or null
// ---------------------------------------------------------------------------

function detectCycle(
  nodes: string[],
  predecessors: Map<string, string[]>,
): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();

  for (const n of nodes) color.set(n, WHITE);

  function dfs(u: string): string[] | null {
    color.set(u, GRAY);
    for (const v of predecessors.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) {
        // Found a back edge u → v; reconstruct cycle v → ... → u → v
        const cycle: string[] = [v, u];
        let cur = u;
        while (parent.has(cur) && parent.get(cur) !== v) {
          cur = parent.get(cur)!;
          cycle.push(cur);
        }
        cycle.push(v);
        cycle.reverse();
        return cycle;
      }
      if (c === WHITE) {
        parent.set(v, u);
        const res = dfs(v);
        if (res) return res;
      }
    }
    color.set(u, BLACK);
    return null;
  }

  for (const n of nodes) {
    if (color.get(n) === WHITE) {
      const res = dfs(n);
      if (res) return res;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// Returns nodes in topological order, or null if a cycle is present
// ---------------------------------------------------------------------------

function topologicalSort(
  nodes: string[],
  predecessors: Map<string, string[]>,
  successors: Map<string, string[]>,
): string[] | null {
  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n, (predecessors.get(n) ?? []).length);

  const queue: string[] = [];
  for (const n of nodes) {
    if (indegree.get(n)! === 0) queue.push(n);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    order.push(u);
    for (const v of successors.get(u) ?? []) {
      const d = indegree.get(v)! - 1;
      indegree.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  if (order.length !== nodes.length) return null; // cycle present
  return order;
}

// ---------------------------------------------------------------------------
// Critical path via DP (FR-2.3)
// Forward pass: earliest finish time for each node
// Backward pass: trace the longest path
// ---------------------------------------------------------------------------

function computeCriticalPath(
  topoOrder: string[],
  predecessors: Map<string, string[]>,
  durationMap: Map<string, number>,
): { path: string[]; length: number } {
  // earliest finish time for each node
  const eft = new Map<string, number>();
  const bestPred = new Map<string, string | null>();

  for (const u of topoOrder) {
    const dur = durationMap.get(u) ?? 0;
    let maxPredTime = 0;
    let maxPredNode: string | null = null;
    for (const p of predecessors.get(u) ?? []) {
      const pt = eft.get(p) ?? 0;
      if (pt > maxPredTime) {
        maxPredTime = pt;
        maxPredNode = p;
      }
    }
    eft.set(u, maxPredTime + dur);
    bestPred.set(u, maxPredNode);
  }

  // Find the node with maximum eft (the end of the critical path)
  let lastNode = topoOrder[0] ?? "";
  let maxEft = 0;
  for (const u of topoOrder) {
    const t = eft.get(u) ?? 0;
    if (t > maxEft) { maxEft = t; lastNode = u; }
  }

  // Trace backward
  const path: string[] = [];
  let cur: string | null = lastNode;
  while (cur) {
    path.push(cur);
    cur = bestPred.get(cur) ?? null;
  }
  path.reverse();

  return { path, length: maxEft };
}

// ---------------------------------------------------------------------------
// Public: buildDAG
// ---------------------------------------------------------------------------

export function buildDAG(tasks: TaskInput[]): DependencyGraph | AnalysisError {
  const ids = new Set(tasks.map((t) => t.id));

  // --- Validate: unknown dependency references (non-blocking per FR-5.1) ---
  // We just skip them (callers collect warnings separately)

  // --- Validate: empty task list (FR-5.1) ---
  if (tasks.length === 0) {
    return {
      error_code: "EMPTY_INPUT",
      message: "Task list is empty",
      details: { cause: [] },
    };
  }

  // --- Build adjacency ---
  const { successors, predecessors } = buildAdjacency(tasks);

  // --- Cycle detection (FR-2.2) ---
  const cycle = detectCycle(Array.from(ids), predecessors);
  if (cycle) {
    return {
      error_code: "CIRCULAR_DEPENDENCY",
      message: "Circular dependency detected",
      details: { cause: cycle },
    };
  }

  // --- Topological sort ---
  const topoOrder = topologicalSort(Array.from(ids), predecessors, successors)!;
  // safe because we already checked for cycles

  // --- Build nodes ---
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const nodes: Node[] = [];
  for (const id of ids) {
    const t = taskMap.get(id)!;
    nodes.push({
      id,
      name: t.name,
      in_degree: (predecessors.get(id) ?? []).length,
      out_degree: (successors.get(id) ?? []).length,
    });
  }

  // --- Build edges ---
  const edges: Edge[] = [];
  for (const t of tasks) {
    for (const dep of t.depends_on ?? []) {
      if (!ids.has(dep)) continue;
      edges.push({
        from: dep,
        to: t.id,
        duration: taskMap.get(dep)?.estimated_duration,
      });
    }
  }

  // --- Critical path (FR-2.3) ---
  const durationMap = new Map(tasks.map((t) => [t.id, t.estimated_duration ?? 0]));
  const cp = computeCriticalPath(topoOrder, predecessors, durationMap);
  const cpSet = new Set(cp.path);

  // Critical-path edges: edges where both endpoints are on the critical path
  // AND the edge is traversed in the critical path order
  const cpEdgeSet = new Set<string>();
  for (let i = 1; i < cp.path.length; i++) {
    cpEdgeSet.add(`${cp.path[i - 1]}→${cp.path[i]}`);
  }
  const criticalPathEdges = edges.filter((e) =>
    cpEdgeSet.has(`${e.from}→${e.to}`),
  );

  return {
    nodes,
    edges,
    critical_path_nodes: cp.path,
    critical_path_edges: criticalPathEdges,
  };
}

/** Check if a graph is a valid DAG (no cycles). */
export function isDAG(graph: DependencyGraph): boolean {
  // Build predecessor map from edges
  const preds = new Map<string, string[]>();
  for (const n of graph.nodes) preds.set(n.id, []);
  for (const e of graph.edges) {
    if (!preds.has(e.to)) preds.set(e.to, []);
    preds.get(e.to)!.push(e.from);
  }
  return detectCycle(graph.nodes.map((n) => n.id), preds) === null;
}

// ---------------------------------------------------------------------------
// Re-export internal functions for unit testing
// ---------------------------------------------------------------------------

export { detectCycle, topologicalSort, computeCriticalPath, buildAdjacency };

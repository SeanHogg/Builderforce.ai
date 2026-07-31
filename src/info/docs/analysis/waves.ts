// waves.ts — compute execution waves from a DAG (FR-3)

import type { DependencyGraph, Wave, TaskInput } from "./types";

/**
 * Compute execution waves from a dependency graph.
 *
 * A wave groups all tasks whose dependencies are satisfied by earlier waves
 * and that have no dependencies on each other.  This is equivalent to
 * grouping by topological depth — the length of the longest path from any
 * source node to the task.
 */
export function computeWaves(
  graph: DependencyGraph,
  tasks: TaskInput[],
): Wave[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Build predecessor map from edges
  const predecessors = new Map<string, string[]>();
  for (const n of graph.nodes) {
    predecessors.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!predecessors.has(e.to)) predecessors.set(e.to, []);
    predecessors.get(e.to)!.push(e.from);
  }

  // Compute topological depth for each node (longest incoming path)
  const depth = new Map<string, number>();
  const topoOrder = topologicalOrder(graph);

  for (const u of topoOrder) {
    let maxPredDepth = 0;
    for (const p of predecessors.get(u) ?? []) {
      const pd = depth.get(p) ?? 0;
      if (pd > maxPredDepth) maxPredDepth = pd;
    }
    // Waves are 1-based: depth 0 → wave 1
    depth.set(u, maxPredDepth + 1);
  }

  // Group by depth
  const waveMap = new Map<number, string[]>();
  for (const [id, d] of depth) {
    if (!waveMap.has(d)) waveMap.set(d, []);
    waveMap.get(d)!.push(id);
  }

  // Convert to Wave objects, sorted by depth
  const maxDepth = Math.max(...waveMap.keys(), 0);
  const waves: Wave[] = [];

  for (let d = 1; d <= maxDepth; d++) {
    const ids = waveMap.get(d) ?? [];
    const names = ids.map((id) => taskMap.get(id)?.name ?? id);
    const durations = ids.map(
      (id) => taskMap.get(id)?.estimated_duration ?? 0,
    );
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
    const totalDuration = durations.reduce((a, b) => a + b, 0);

    waves.push({
      wave_number: d,
      task_ids: ids,
      task_names: names,
      max_duration: maxDuration,
      total_duration: totalDuration,
    });
  }

  return waves;
}

/**
 * Compute the topological order from the DAG.
 * Returns a stable order (nodes sorted lexicographically when ties exist).
 */
function topologicalOrder(graph: DependencyGraph): string[] {
  const indegree = new Map<string, number>();
  const successors = new Map<string, string[]>();

  for (const n of graph.nodes) {
    indegree.set(n.id, 0);
    successors.set(n.id, []);
  }
  for (const e of graph.edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    successors.get(e.from)!.push(e.to);
  }

  // Use a priority queue (lexicographic) for stable ordering
  const queue: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort(); // stable start

  const order: string[] = [];
  while (queue.length > 0) {
    // Sort to maintain stability
    queue.sort();
    const u = queue.shift()!;
    order.push(u);

    const nextBatch: string[] = [];
    for (const v of successors.get(u) ?? []) {
      const d = indegree.get(v)! - 1;
      indegree.set(v, d);
      if (d === 0) nextBatch.push(v);
    }
    // Sort the batch before adding to queue
    nextBatch.sort();
    queue.push(...nextBatch);
  }

  return order;
}

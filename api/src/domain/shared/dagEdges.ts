/**
 * Reachability over a directed edge list — THE cycle gate for every dependency graph.
 *
 * Two dependency graphs refuse cycle-closing edges at write time: task precedence
 * edges (application/task/taskDependencies.ts, per project) and PMO initiative edges
 * (application/pmo/initiativeDependencies.ts, per segment). Each used to carry its own
 * walk — one BFS keyed on task ids, one DFS keyed on initiative ids — which is two
 * places for the next "the walk loops on corrupt data" fix to be applied to only one.
 * The graphs stay separate (different nodes, tables and scopes); the walk is shared.
 * Pure: no I/O, so the rule is testable as a table.
 */

/** A directed edge `[from, to]`. */
export type DirectedEdge<K> = readonly [from: K, to: K];

/**
 * Can `target` be reached from `start` along `edges`? `start === target` is reachable
 * (the empty path). Visited-set guarded, so an existing cycle in the data — which the
 * gate exists to prevent, but the database does not forbid — cannot loop it forever.
 */
export function isReachable<K>(edges: Iterable<DirectedEdge<K>>, start: K, target: K): boolean {
  const adjacency = new Map<K, K[]>();
  for (const [from, to] of edges) {
    const next = adjacency.get(from);
    if (next) next.push(to);
    else adjacency.set(from, [to]);
  }
  const seen = new Set<K>([start]);
  const queue: K[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i] as K;
    if (current === target) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Would adding `from → to` close a cycle? Exactly when `from` is already reachable
 * from `to` — which includes the self-loop `from === to`.
 */
export function wouldCloseCycle<K>(edges: Iterable<DirectedEdge<K>>, from: K, to: K): boolean {
  return isReachable(edges, to, from);
}

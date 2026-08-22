/**
 * Would this edge close a cycle? — pure graph arithmetic, no database.
 *
 * A dependency graph that is allowed to contain a cycle is a graph that cannot
 * be topologically ordered, which means a prerequisite chain has no first course,
 * a Gantt has no start, and any "what can I do next" walk runs forever. Every one
 * of those is discovered at READ time, by which point the bad edge has been
 * stored and the person who wrote it is gone.
 *
 * So the check belongs at write time, and it belongs here rather than inside a
 * service: it is arithmetic over a set of pairs, it has no reason to know what a
 * course or a task is, and it is exactly the kind of rule that deserves a test
 * with no fixtures in it. `taskDependencies.ts` already made this argument for
 * task edges and grew its own copy; this is the shared one.
 */

/** One directed edge. Ids are opaque strings — a uuid, a numeric id as text. */
export interface GraphEdge {
  from: string;
  to: string;
}

/**
 * Every node reachable by following edges FORWARD from `start`, excluding
 * `start` itself unless a cycle already leads back to it.
 *
 * Iterative rather than recursive: a deep prerequisite chain is legitimate data,
 * and blowing the stack on legitimate data is a worse failure than the one this
 * is here to prevent.
 */
export function reachableFrom(edges: readonly GraphEdge[], start: string): Set<string> {
  const forward = new Map<string, string[]>();
  for (const edge of edges) {
    const bucket = forward.get(edge.from);
    if (bucket) bucket.push(edge.to);
    else forward.set(edge.from, [edge.to]);
  }

  const seen = new Set<string>();
  const stack = [...(forward.get(start) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const next = forward.get(node);
    if (next) stack.push(...next);
  }
  return seen;
}

/**
 * Would adding `from → to` create a cycle in an already-acyclic set of edges?
 *
 * True when `to` can already reach `from`, and true for a self-edge — which the
 * database's own unique index does NOT stop, because `(from, to)` being distinct
 * pairs says nothing about them being distinct nodes.
 */
export function wouldCycle(edges: readonly GraphEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  return reachableFrom(edges, to).has(from);
}

/**
 * Topological order, or null if the graph has a cycle.
 *
 * Kahn's algorithm. Returning null rather than throwing lets a READER degrade —
 * a list that cannot be sequenced is still a list worth showing — while a WRITER
 * uses {@link wouldCycle} to refuse the edge that would cause this in the first
 * place. Ties are broken by the order nodes were given, so a stable input
 * produces a stable order rather than one that shuffles between requests.
 */
export function topoOrder(nodes: readonly string[], edges: readonly GraphEdge[]): string[] | null {
  const known = new Set(nodes);
  const indegree = new Map<string, number>(nodes.map((n) => [n, 0]));
  const forward = new Map<string, string[]>();

  for (const edge of edges) {
    // An edge touching a node outside this set is not this graph's business —
    // a prerequisite on a course the learner cannot see must not silently
    // remove every course that depends on it from the ordering.
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const bucket = forward.get(edge.from);
    if (bucket) bucket.push(edge.to);
    else forward.set(edge.from, [edge.to]);
  }

  const ready = nodes.filter((n) => indegree.get(n) === 0);
  const ordered: string[] = [];

  while (ready.length > 0) {
    const node = ready.shift()!;
    ordered.push(node);
    for (const next of forward.get(node) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  return ordered.length === nodes.length ? ordered : null;
}

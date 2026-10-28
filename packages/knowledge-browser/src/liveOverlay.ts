/**
 * The browser's Live lens input (PRD 38 §4.5: "Live: … VFS watch (web)"). The server-built
 * graph does not change until the next review, so files written since it was built are
 * marked on the graph the view already has: a `changed` badge on each, and `co-changed`
 * edges between files that changed together. Nothing is written to memory.
 */

import { srcRef, type KEdge, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

/** Files linked pairwise as co-changed, at most (pairs grow quadratically). */
export const LIVE_PAIR_FILES = 12;

export function applyLiveOverlay(graph: KnowledgeGraph, changedPaths: Iterable<string>): KnowledgeGraph {
  const rootId = graph.scope.rootId;
  const changed = new Set([...changedPaths].map((p) => srcRef(rootId, p) as string));
  const present = graph.nodes.filter((n) => changed.has(n.ref)).map((n) => n.ref).sort();
  if (present.length === 0) return graph;
  const nodes = graph.nodes.map((n) => (changed.has(n.ref) ? { ...n, badges: { ...(n.badges ?? {}), changed: 1 } } : n));
  const pairs: KEdge[] = [];
  const run = present.slice(0, LIVE_PAIR_FILES);
  for (let i = 0; i < run.length; i++) {
    for (let j = i + 1; j < run.length; j++) {
      pairs.push({ from: run[i] as KEdge['from'], to: run[j] as KEdge['to'], kind: 'co-changed', weight: 1, origin: 'agent' });
    }
  }
  const edges = [...graph.edges.filter((e) => e.kind !== 'co-changed'), ...pairs];
  return { ...graph, nodes, edges, stats: { ...graph.stats, edges: edges.length } };
}

/**
 * How big a graph is, for the one decision that depends on it: compute in the same render (small) or off the main thread.
 * Up to {@link INLINE_WEIGHT} elements the work is a few milliseconds and a worker round trip would cost more.
 *
 * The deterministic profiler gates on this: a graph above {@link INLINE_WEIGHT} is NEVER computed on the main thread,
 * in any view and on any recompute — the worker (or the idle-step fallback) answers and the previous drawn set stays
 * until the new one lands. Small graphs always compute inline so a small view paints complete on its first frame.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

export const INLINE_WEIGHT = 20_000;

/** Nodes, edges, findings and the outline's files and links. */
export function weightOf(graph: Pick<KnowledgeGraph, 'nodes' | 'edges' | 'findings' | 'outline'>): number {
    return graph.nodes.length + graph.edges.length + graph.findings.length + (graph.outline?.files.length ?? 0) + (graph.outline?.links.length ?? 0);
}

export const isSmall = (graph: Pick<KnowledgeGraph, 'nodes' | 'edges' | 'findings' | 'outline'>): boolean => weightOf(graph) <= INLINE_WEIGHT;

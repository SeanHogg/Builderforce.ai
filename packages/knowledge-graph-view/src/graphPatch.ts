/**
 * graphPatch.ts — applies one live change batch (`KnowledgeGraphPatch`, `types.ts`'s
 * `subscribeLive` `onPatch`) to the graph on screen, so the view updates without a whole
 * rebuild: drop the removed nodes and edges, upsert the batch's new ones, flag the stale
 * refs, then let the host decorate the result (its live overlay). Pure.
 */

import type { KEdge, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeEdgeKey, KnowledgeGraphPatch, LiveGraphDecorate } from './types';

const edgeKey = (e: KEdge): string => `${e.from} ${e.to} ${e.kind}`;
const keyOf = (k: KnowledgeEdgeKey): string => `${k.from} ${k.to} ${k.kind}`;

/**
 * The graph with the patch's batch applied: `removedNodes`/`removedEdges` gone, `upsertNodes`/
 * `upsertEdges` replacing (or appending) by identity, refs in `stale` flagged, then `decorate`.
 */
export function applyGraphPatch(graph: KnowledgeGraph, patch: KnowledgeGraphPatch, decorate?: LiveGraphDecorate): KnowledgeGraph {
    const removedNodes = new Set(patch.removedNodes);
    const removedEdges = new Set(patch.removedEdges.map(keyOf));
    const stale = new Set(patch.stale);
    const upsertNodes = new Map(patch.upsertNodes.map((n) => [n.ref, n]));
    const upsertEdges = new Map(patch.upsertEdges.map((e) => [edgeKey(e), e]));
    const nodes = graph.nodes
        .filter((n) => !removedNodes.has(n.ref))
        .map((n) => upsertNodes.get(n.ref) ?? (stale.has(n.ref) && !n.stale ? { ...n, stale: true } : n));
    const seen = new Set(nodes.map((n) => n.ref));
    for (const n of patch.upsertNodes) if (!seen.has(n.ref)) nodes.push(n);
    const edges = graph.edges.filter((e) => (
        !removedEdges.has(edgeKey(e))
        && !upsertEdges.has(edgeKey(e))
        && !removedNodes.has(e.from)
        && !removedNodes.has(e.to)
    ));
    for (const e of patch.upsertEdges) {
        if (removedNodes.has(e.from) || removedNodes.has(e.to)) continue;
        edges.push(e);
    }
    const next: KnowledgeGraph = {
        ...graph,
        nodes,
        edges,
        stats: {
            ...graph.stats,
            nodes: nodes.length,
            edges: edges.length,
            stale: nodes.reduce((n, node) => (node.stale ? n + 1 : n), 0),
        },
    };
    return decorate ? decorate(next) : next;
}

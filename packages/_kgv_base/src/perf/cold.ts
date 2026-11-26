/**
 * Cold inputs for the harness. The view's memos (`weakMemo`, `canonicalEdges`, the station-pair counts, the outline view) are
 * WeakMaps keyed by an array or graph OBJECT, so a structural clone (new graph, new arrays, same element objects) misses every
 * one of them. Built OUTSIDE the timed region (`Recorder.time`'s `fresh`), each iteration measures the real computation.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

export function coldGraph(graph: KnowledgeGraph): KnowledgeGraph {
    const { outline } = graph;
    return {
        ...graph,
        nodes: graph.nodes.slice(),
        edges: graph.edges.slice(),
        findings: graph.findings.slice(),
        ...(outline ? { outline: { ...outline, files: outline.files.slice(), links: outline.links.slice() } } : {}),
    };
}

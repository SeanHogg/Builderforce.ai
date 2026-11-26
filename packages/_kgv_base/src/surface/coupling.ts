/**
 * Hidden coupling (PRD 38 P4): a file's co-change partners that share no reference with it. Memory computes the partners
 * (`coChange`, read ONLY through its `decodeCoChange`) and their count (`coChangeHidden`) in `buildGraph`; this only picks,
 * from the decoded list, the partners the graph the view holds draws no reference to, by memory's own reference test
 * (a live `COMMUNITY_EDGE_KINDS` edge between the two files, either direction). It computes no rate.
 */

import { COCHANGE_BADGE, COMMUNITY_EDGE_KINDS, decodeCoChange, fileRefOf, type CoChangeBadgeEntry, type KnowledgeGraph, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex } from '../graphModel';

const referenced = new WeakMap<KnowledgeGraph, Map<NodeRef, Set<NodeRef>>>();

/** File → the files it shares a live reference with (both directions), once per graph. */
function referencesOf(graph: KnowledgeGraph): Map<NodeRef, Set<NodeRef>> {
    const hit = referenced.get(graph);
    if (hit) return hit;
    const out = new Map<NodeRef, Set<NodeRef>>();
    const link = (a: NodeRef, b: NodeRef) => (out.get(a) ?? out.set(a, new Set()).get(a)!).add(b);
    for (const e of graph.edges) {
        if (e.stale || !COMMUNITY_EDGE_KINDS.includes(e.kind)) continue;
        const a = fileRefOf(e.from), b = fileRefOf(e.to);
        if (a === b) continue;
        link(a, b);
        link(b, a);
    }
    referenced.set(graph, out);
    return out;
}

/** The file's hidden partners, in memory's order (confidence desc); empty when it has no co-change list. */
export function hiddenPartners(graph: KnowledgeGraph, ref: string): CoChangeBadgeEntry[] {
    const file = fileRefOf(ref as NodeRef);
    const node = nodeIndex(graph).get(file);
    const value = node?.badges?.[COCHANGE_BADGE];
    if (value === undefined) return [];
    const near = referencesOf(graph).get(file);
    return decodeCoChange(value).filter((p) => p.ref !== file && !near?.has(p.ref));
}

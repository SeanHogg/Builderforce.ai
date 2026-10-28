/**
 * Pure readings of a `KnowledgeGraph` the view needs — focus, labels, neighbours,
 * search, the partition matrix and the before/after comparison. No graph logic lives
 * here that memory owns (building, findings, tracing): this only SELECTS from a graph.
 */

import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { LensDef } from './lenses';

/** Nodes at a phone's width (PRD 38 §4.6: "the view opens focused, top 60"). */
export const PHONE_FOCUS_NODES = 60;
export const COMPACT_WIDTH = 520;

export interface VisibleGraph {
    nodes: KNode[];
    edges: KEdge[];
}

const byImportance = (a: KNode, b: KNode): number =>
    b.importance - a.importance || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);

/** The top `max` nodes by importance plus every `keep` ref, and the edges between them. */
export function focusGraph(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>, max: number, keep: readonly string[] = []): VisibleGraph {
    if (graph.nodes.length <= max) return { nodes: graph.nodes, edges: graph.edges };
    const wanted = new Set(keep);
    const picked = [...graph.nodes].sort(byImportance).slice(0, max);
    const refs = new Set(picked.map((n) => n.ref));
    for (const n of graph.nodes) if (wanted.has(n.ref) && !refs.has(n.ref)) { picked.push(n); refs.add(n.ref); }
    return { nodes: picked, edges: graph.edges.filter((e) => refs.has(e.from) && refs.has(e.to)) };
}

/** A lens's reading: its edges only; nodes keep their place (dimmed by `nodeStyle`). */
export function lensGraph(visible: VisibleGraph, lens: LensDef): VisibleGraph {
    return { nodes: visible.nodes, edges: visible.edges.filter((e) => lens.edgeFilter(e)) };
}

export function nodeIndex(graph: Pick<KnowledgeGraph, 'nodes'>): Map<string, KNode> {
    return new Map(graph.nodes.map((n) => [n.ref, n] as const));
}

/** A ref's human label: the node's own, else the path tail of a `src:` ref, else the ref. */
export function labelFor(index: ReadonlyMap<string, KNode>, ref: string): string {
    const n = index.get(ref);
    if (n) return n.label;
    const at = ref.indexOf('::');
    return at >= 0 ? ref.slice(at + 2) : ref;
}

/** Facts, claims and entities about a node (its `about` edges, both directions). */
export function knowledgeAbout(graph: KnowledgeGraph, ref: string): { facts: KNode[]; claims: KNode[] } {
    const index = nodeIndex(graph);
    const related = new Set<string>();
    for (const e of graph.edges) {
        if (e.kind !== 'about' && e.kind !== 'mentions') continue;
        if (e.to === ref) related.add(e.from);
        else if (e.from === ref) related.add(e.to);
    }
    const nodes = [...related].map((r) => index.get(r)).filter((n): n is KNode => !!n && n.origin !== 'extracted');
    return {
        facts: nodes.filter((n) => n.kind !== 'claim').sort(byImportance),
        claims: nodes.filter((n) => n.kind === 'claim').sort(byImportance),
    };
}

/** Local search when the host has no index: case-insensitive label/ref match, best first. */
export function localSearch(graph: Pick<KnowledgeGraph, 'nodes'>, q: string, k = 20): Array<{ ref: string; score: number; tier: string }> {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const hits: Array<{ ref: string; score: number; tier: string }> = [];
    for (const n of graph.nodes) {
        const label = n.label.toLowerCase();
        const at = label.indexOf(needle);
        const inRef = n.ref.toLowerCase().includes(needle);
        if (at < 0 && !inRef) continue;
        const score = (label === needle ? 3 : at === 0 ? 2 : at > 0 ? 1 : 0.5) + n.importance;
        hits.push({ ref: n.ref, score, tier: 'exact' });
    }
    return hits.sort((a, b) => b.score - a.score || (a.ref < b.ref ? -1 : 1)).slice(0, k);
}

/** The partition matrix: cross-partition edge counts, and the worst verdict per cell. */
export interface PartitionCell { count: number; verdict?: 'allowed' | 'same' | 'skips' | 'upward' }
export function partitionMatrix(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): { partitions: string[]; cells: Map<string, PartitionCell> } {
    const part = new Map(graph.nodes.map((n) => [n.ref, n.partition] as const));
    const cells = new Map<string, PartitionCell>();
    const seen = new Set<string>();
    const rank = { allowed: 0, same: 0, skips: 1, upward: 2 } as const;
    for (const e of graph.edges) {
        const a = part.get(e.from), b = part.get(e.to);
        if (a === undefined || b === undefined || e.verdict === undefined) continue;
        seen.add(a); seen.add(b);
        const key = `${a}\u0000${b}`;
        const cell = cells.get(key) ?? { count: 0 };
        cell.count += 1;
        if (!cell.verdict || rank[e.verdict] > rank[cell.verdict]) cell.verdict = e.verdict;
        cells.set(key, cell);
    }
    return { partitions: [...seen].sort(), cells };
}

export const matrixKey = (from: string, to: string): string => `${from}\u0000${to}`;

/** Findings per kind before and after, with what appeared and what was resolved. */
export interface GraphComparison {
    kinds: Array<{ kind: string; before: number; after: number }>;
    added: Finding[];
    resolved: Finding[];
    nodes: { before: number; after: number };
}

export function compareGraphs(before: KnowledgeGraph, after: KnowledgeGraph): GraphComparison {
    const count = (g: KnowledgeGraph) => {
        const m = new Map<string, number>();
        for (const f of g.findings) m.set(f.kind, (m.get(f.kind) ?? 0) + 1);
        return m;
    };
    const b = count(before), a = count(after);
    const kinds = [...new Set([...b.keys(), ...a.keys()])].sort()
        .map((kind) => ({ kind, before: b.get(kind) ?? 0, after: a.get(kind) ?? 0 }));
    const beforeIds = new Set(before.findings.map((f) => f.id));
    const afterIds = new Set(after.findings.map((f) => f.id));
    return {
        kinds,
        added: after.findings.filter((f) => !beforeIds.has(f.id)),
        resolved: before.findings.filter((f) => !afterIds.has(f.id)),
        nodes: { before: before.nodes.length, after: after.nodes.length },
    };
}

/** Nodes grouped by partition (the list fallback), partitions sorted, nodes by importance. */
export function byPartition(nodes: readonly KNode[]): Array<{ partition: string | undefined; nodes: KNode[] }> {
    const groups = new Map<string | undefined, KNode[]>();
    for (const n of nodes) (groups.get(n.partition) ?? groups.set(n.partition, []).get(n.partition)!).push(n);
    return [...groups.entries()]
        .sort(([a], [b]) => (a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : a > b ? 1 : 0))
        .map(([partition, list]) => ({ partition, nodes: list.sort(byImportance) }));
}

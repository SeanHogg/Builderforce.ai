/**
 * Pure readings of a `KnowledgeGraph` the view needs — focus, labels, neighbours,
 * search, the partition matrix and the before/after comparison. No graph logic lives
 * here that memory owns (building, findings, tracing): this only SELECTS from a graph.
 */

import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { LensDef } from './lenses';
import { cmp } from './order';

/** Nodes at a phone's width (PRD 38 §4.6: "the view opens focused, top 60"). */
export const PHONE_FOCUS_NODES = 60;
export const COMPACT_WIDTH = 520;

export interface VisibleGraph {
    nodes: KNode[];
    edges: KEdge[];
}

/** Importance descending, ties by ref. */
export const byImportance = (a: KNode, b: KNode): number =>
    b.importance - a.importance || cmp(a.ref, b.ref);

/** What `focusGraph` keeps per graph: the top-`max` base (per `max`), and the per-ref indexes that let a kept ref be added cheaply. */
interface FocusCache {
    nodes: readonly KNode[];
    bases: Map<number, { visible: VisibleGraph; refs: ReadonlySet<string> }>;
    index: { byRef: Map<string, KNode>; incident: Map<string, KEdge[]> } | null;
}
const focusCaches = new WeakMap<readonly KEdge[], FocusCache>();

function cacheOf(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): FocusCache {
    const held = focusCaches.get(graph.edges);
    if (held && held.nodes === graph.nodes) return held;
    const fresh: FocusCache = { nodes: graph.nodes, bases: new Map(), index: null };
    focusCaches.set(graph.edges, fresh);
    return fresh;
}

/**
 * The top `max` nodes by importance plus every `keep` ref, and the edges between them.
 *
 * The expensive part (sorting every node, filtering every edge) is the BASE: it depends only on the graph and `max`, so it
 * is computed once and remembered. `keep` is a cheap add-on: when every kept ref is already in the base, the base itself comes
 * back (the very same arrays, so everything keyed on them stays put when the selection moves inside it); otherwise only the
 * missing nodes and the edges touching them are added, from an incident index built once per graph.
 */
export function focusGraph(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>, max: number, keep: readonly string[] = []): VisibleGraph {
    if (graph.nodes.length <= max) return { nodes: graph.nodes, edges: graph.edges };
    const cache = cacheOf(graph);
    let base = cache.bases.get(max);
    if (!base) {
        const nodes = [...graph.nodes].sort(byImportance).slice(0, max);
        const refs = new Set<string>(nodes.map((n) => n.ref));
        base = { visible: { nodes, edges: graph.edges.filter((e) => refs.has(e.from) && refs.has(e.to)) }, refs };
        cache.bases.set(max, base);
    }
    const missing = [...new Set(keep)].filter((r) => !base.refs.has(r));
    if (missing.length === 0) return base.visible;

    if (!cache.index) {
        const incident = new Map<string, KEdge[]>();
        const link = (ref: string, e: KEdge): void => { const l = incident.get(ref); if (l) l.push(e); else incident.set(ref, [e]); };
        for (const e of graph.edges) { link(e.from, e); if (e.to !== e.from) link(e.to, e); }
        cache.index = { byRef: new Map(graph.nodes.map((n) => [n.ref as string, n] as const)), incident };
    }
    const { byRef, incident } = cache.index;
    const extra = missing.flatMap((r) => byRef.get(r) ?? []);
    const refs = new Set<string>([...base.refs, ...extra.map((n) => n.ref)]);
    const added = new Set<KEdge>();
    for (const n of extra) for (const e of incident.get(n.ref) ?? []) if (refs.has(e.from) && refs.has(e.to)) added.add(e);
    return { nodes: [...base.visible.nodes, ...extra], edges: [...base.visible.edges, ...added] };
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

/** A `src:` ref's root-relative file path (a section's `#anchor` dropped); undefined for facts and entities. */
export function pathOf(ref: string): string | undefined {
    if (!ref.startsWith('src:')) return undefined;
    const at = ref.indexOf('::');
    if (at < 0) return undefined;
    const path = ref.slice(at + 2);
    const hash = path.indexOf('#');
    return hash >= 0 ? path.slice(0, hash) : path;
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
    return hits.sort((a, b) => b.score - a.score || cmp(a.ref, b.ref)).slice(0, k);
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
        .sort(([a], [b]) => (a === undefined ? 1 : b === undefined ? -1 : cmp(a, b)))
        .map(([partition, list]) => ({ partition, nodes: list.sort(byImportance) }));
}

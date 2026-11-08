/**
 * The outline-to-map adapter (ONE place). A truncated graph carries `outline`: every file and
 * every file-to-file reference of the FULL graph. The map (stations, lines) reads that instead
 * of the truncated nodes and edges, so a big repo keeps all of its areas and entry points.
 *
 * It returns the shape the map already consumes (file nodes + `references` edges), so stations
 * and lines need no second code path. Verdicts and the cycle flag are decoded here once, from
 * the outline's own codes, and never recomputed downstream. A file the graph kept stays the
 * graph's own node (live badges, hash, label); only the files the cut dropped are built from the
 * outline. A graph with no outline returns null and the callers keep reading the graph itself.
 *
 * Decoding is cached per OUTLINE object (live overlays copy the graph but share its outline), the
 * cheap merge with the graph's own nodes per graph.
 */

import {
    OUTLINE_BADGE_KEYS, OUTLINE_FLAG_CYCLE, OUTLINE_VERDICTS, outlineOf, outlineRef,
    type GraphOutline, type KEdge, type KNode, type KnowledgeGraph,
} from '@seanhogg/builderforce-memory/knowledge';

export interface OutlineView {
    /** The full graph's files as nodes (kind `file`): the graph's own where it kept them, else built from the outline. */
    files: KNode[];
    /** The full graph's file-to-file references, with their verdict and cycle flag. */
    edges: KEdge[];
    /** The outline itself was capped (OUTLINE_MAX_*): the map shows `shown` of about `total` files. */
    capped: boolean;
    shown: number;
    total: number;
}

interface Decoded { files: KNode[]; edges: KEdge[] }

const decodedBy = new WeakMap<GraphOutline, Decoded>();
const viewBy = new WeakMap<KnowledgeGraph, OutlineView>();

/** The last segment of a path (the whole thing when it has no slash): the ONE tail the map uses for file names. */
export const tailOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

function badgesOf(badges: Record<string, number | string> | undefined): KNode['badges'] | undefined {
    if (!badges) return undefined;
    const out: Record<string, number | string> = {};
    for (const key of OUTLINE_BADGE_KEYS) if (badges[key] !== undefined) out[key] = badges[key]!;
    return Object.keys(out).length > 0 ? out : undefined;
}

/** The system, app and stray-copy tags an outline file carries as indexes into the outline's pools (PRD 41 A9), resolved onto its node (in this order). */
function addTags(node: Mutable<KNode>, outline: GraphOutline, f: object): void {
    const o = outline as GraphOutline & { systems?: string[]; apps?: string[] };
    const t = f as { system?: number; app?: number; copyOf?: number };
    const system = t.system !== undefined ? o.systems?.[t.system] : undefined;
    const app = t.app !== undefined ? o.apps?.[t.app] : undefined;
    const copyOf = t.copyOf !== undefined ? o.systems?.[t.copyOf] : undefined;
    if (system !== undefined) Object.assign(node, { system });
    if (app) Object.assign(node, { app });
    if (copyOf !== undefined) Object.assign(node, { copyOf });
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function decode(outline: GraphOutline): Decoded {
    const files: KNode[] = outline.files.map((f) => {
        const badges = badgesOf(f.badges);
        // The outline's 12-character hash is not a sourceHash (it never equals a real one), so it is not carried.
        // Built field by field (no spread per file or per link): 16k files and 150k links are decoded here.
        const node: Mutable<KNode> = {
            ref: outlineRef(outline, f), kind: 'file', label: tailOf(f.path), pack: 'code', importance: f.importance, origin: 'extracted',
        };
        if (f.area !== undefined && outline.areas[f.area] !== undefined) node.area = outline.areas[f.area]!;
        if (f.partition !== undefined && outline.partitions[f.partition] !== undefined) node.partition = outline.partitions[f.partition]!;
        if (badges) node.badges = badges;
        addTags(node, outline, f);
        return node;
    });
    const edges: KEdge[] = [];
    for (const [from, to, code, flags] of outline.links) {
        const a = files[from], b = files[to];
        if (!a || !b) continue;
        const verdict = OUTLINE_VERDICTS[code];
        const edge: Mutable<KEdge> = { from: a.ref, to: b.ref, kind: 'references', weight: 1, origin: 'extracted' };
        if (verdict && verdict !== 'none') edge.verdict = verdict;
        if ((flags & OUTLINE_FLAG_CYCLE) !== 0) edge.cycle = true;
        edges.push(edge);
    }
    return { files, edges };
}

/** The map's view of a truncated graph's outline; null when the graph carries none (read the graph itself). */
export function outlineView(graph: KnowledgeGraph): OutlineView | null {
    if (!graph.outline || !graph.stats?.truncated) return null;
    const cached = viewBy.get(graph);
    if (cached) return cached;
    const outline = outlineOf(graph);
    let decoded = decodedBy.get(outline);
    if (!decoded) { decoded = decode(outline); decodedBy.set(outline, decoded); }
    const real = new Map<string, KNode>();
    for (const n of graph.nodes) if (n.kind === 'file') real.set(n.ref, n);
    const inOutline = new Set<string>();
    const files = decoded.files.map((f) => { inOutline.add(f.ref); return real.get(f.ref) ?? f; });
    for (const [ref, node] of real) if (!inOutline.has(ref)) files.push(node);
    const view: OutlineView = {
        files, edges: decoded.edges, capped: outline.capped, shown: files.length, total: Math.max(graph.stats.sources, files.length),
    };
    viewBy.set(graph, view);
    return view;
}

/** The files the map reads: the outline's on a truncated graph, else the graph's own file nodes. */
export function fileNodesOf(graph: KnowledgeGraph): KNode[] {
    return outlineView(graph)?.files ?? graph.nodes.filter((n) => n.kind === 'file');
}

/** The references the map reads: the outline's links on a truncated graph, else the graph's own edges. */
export function mapEdges(graph: KnowledgeGraph): readonly KEdge[] {
    return outlineView(graph)?.edges ?? graph.edges;
}

/**
 * The outline-to-map adapter (ONE place). A truncated graph carries `outline`: every file and
 * every file-to-file reference of the FULL graph. The map (stations, lines) reads that instead
 * of the truncated nodes and edges, so a big repo keeps all of its areas and entry points.
 *
 * It returns the shape the map already consumes (file nodes + `references` edges), so stations
 * and lines need no second code path. Verdicts and the cycle flag are decoded here once, from
 * the outline's own codes, and never recomputed downstream. A graph with no outline returns
 * null and the callers keep reading the graph itself.
 */

import {
    OUTLINE_BADGE_KEYS, OUTLINE_FLAG_CYCLE, OUTLINE_VERDICTS, outlineOf, outlineRef,
    type KEdge, type KNode, type KnowledgeGraph,
} from '@seanhogg/builderforce-memory/knowledge';

export interface OutlineView {
    /** The full graph's files as nodes (kind `file`), sorted as the outline is. */
    files: KNode[];
    /** The full graph's file-to-file references, with their verdict and cycle flag. */
    edges: KEdge[];
}

const views = new WeakMap<KnowledgeGraph, OutlineView | null>();

function badgesOf(badges: Record<string, number | string> | undefined): KNode['badges'] | undefined {
    if (!badges) return undefined;
    const out: Record<string, number | string> = {};
    for (const key of OUTLINE_BADGE_KEYS) if (badges[key] !== undefined) out[key] = badges[key]!;
    return Object.keys(out).length > 0 ? out : undefined;
}

function build(graph: KnowledgeGraph): OutlineView {
    const outline = outlineOf(graph);
    const files: KNode[] = outline.files.map((f) => {
        const ref = outlineRef(outline, f);
        const badges = badgesOf(f.badges);
        return {
            ref, kind: 'file', label: f.path, pack: 'code', importance: f.importance, origin: 'extracted',
            ...(f.area !== undefined ? { area: outline.areas[f.area]! } : {}),
            ...(f.partition !== undefined ? { partition: outline.partitions[f.partition]! } : {}),
            ...(f.hash !== undefined ? { sourceHash: f.hash } : {}),
            ...(badges ? { badges } : {}),
        };
    });
    const edges: KEdge[] = outline.links.map(([from, to, code, flags]) => {
        const verdict = OUTLINE_VERDICTS[code];
        return {
            from: files[from]!.ref, to: files[to]!.ref, kind: 'references', weight: 1, origin: 'extracted',
            ...(verdict && verdict !== 'none' ? { verdict } : {}),
            ...((flags & OUTLINE_FLAG_CYCLE) !== 0 ? { cycle: true } : {}),
        };
    });
    return { files, edges };
}

/** The map's view of a truncated graph's outline; null when the graph carries none (read the graph itself). */
export function outlineView(graph: KnowledgeGraph): OutlineView | null {
    if (!graph.outline) return null;
    if (!views.has(graph)) views.set(graph, build(graph));
    return views.get(graph) ?? null;
}

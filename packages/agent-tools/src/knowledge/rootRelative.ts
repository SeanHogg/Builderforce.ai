/**
 * knowledge/rootRelative.ts — an analysis of a WORKSPACE, seen from a reviewed SUB-FOLDER
 * (PRD 38 §4.5): the analyzers and the repo map name files relative to the workspace
 * (`pkg/src/a.ts`), but a root reviewed at `pkg` names its files relative to itself
 * (`src/a.ts`) — the refs of both must agree or the analysis draws nodes the review never
 * made. These map the former onto the latter: the folder's prefix is stripped, and whatever
 * lies outside the folder is dropped (an edge with one end outside, an issue located wholly
 * outside). Pure.
 */

import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import type { SerializedRepoGraphShape } from './codeExtracted.js';

/** `folder` as a prefix: forward slashes, no leading `./` or `/`, no trailing slash; '' = the workspace itself. */
export function folderPrefix(folder: string | undefined): string {
    const f = (folder ?? '').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
    return f === '.' ? '' : f;
}

/** `path` relative to `prefix`, or undefined when it lies outside it. */
export function underFolder(path: string, prefix: string): string | undefined {
    if (!prefix) return path;
    return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : undefined;
}

export function snapshotUnder(snapshot: CodeAnalysisSnapshot, folder: string | undefined): CodeAnalysisSnapshot {
    const prefix = folderPrefix(folder);
    if (!prefix) return snapshot;
    const rel = (p: string): string | undefined => underFolder(p, prefix);
    const edges = snapshot.edges.flatMap((e) => {
        const from = rel(e.from), to = rel(e.to);
        return from !== undefined && to !== undefined ? [{ ...e, from, to }] : [];
    });
    const issues = snapshot.issues.flatMap((issue) => {
        const locations = issue.locations.flatMap((l) => {
            const path = rel(l.path);
            return path !== undefined ? [{ ...l, path }] : [];
        });
        return locations.length > 0 ? [{ ...issue, locations }] : [];
    });
    return {
        ...snapshot,
        nodes: snapshot.nodes.flatMap((n) => { const p = rel(n); return p !== undefined ? [p] : []; }),
        edges,
        issues,
    };
}

export function repoGraphUnder(graph: SerializedRepoGraphShape, folder: string | undefined): SerializedRepoGraphShape {
    const prefix = folderPrefix(folder);
    if (!prefix) return graph;
    const { paths, out } = graph.graph;
    const kept: number[] = [];
    const renumbered = new Map<number, number>();
    const rels: string[] = [];
    paths.forEach((p, i) => {
        const rel = underFolder(p, prefix);
        if (rel === undefined) return;
        renumbered.set(i, kept.length);
        kept.push(i);
        rels.push(rel);
    });
    return {
        ...graph,
        graph: {
            ...graph.graph,
            paths: rels,
            out: kept.map((i) => (out[i] ?? []).flatMap(([to, weight]) => {
                const next = renumbered.get(to);
                return next !== undefined ? [[next, weight] as const] : [];
            })),
        },
    };
}

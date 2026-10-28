/**
 * knowledge/codeExtracted.ts — ROOT-level code perception as knowledge-graph `Extracted`
 * (PRD 38 §4.5, the code pack).
 *
 * Per-file extraction cannot see other files, so cross-file structure is converted here,
 * once per root, from output the platform already produces:
 *
 *   • {@link repoGraphToExtracted} — `@builderforce/repo-map`'s serialized file graph:
 *     `references` edges weighted by the identifiers one file uses that the other defines;
 *   • {@link analysisToExtracted} — `codeAnalysis.ts`'s snapshot: dependency-cruiser import
 *     edges (`references`, weight 0 so PageRank stays repo-map's, `cycle` on circular
 *     ones), jscpd clone groups (`duplicate` edges + the `cloneGroup` badge) and knip's
 *     unused files/exports/dependencies (badges).
 *
 * One Extracted per file. Pure and deterministic: no I/O, equal input ⇒ equal output.
 * Worker-safe — the API builds graphs from uploaded snapshots with these.
 */

import { CLONE_GROUP_BADGE, compareStr, srcRef, type Extracted, type KEdge } from '@seanhogg/builderforce-memory/knowledge';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { CODE_BADGES, codeFileNode, rootLevelExtracted } from './codeNodes.js';

/**
 * The part of `@builderforce/repo-map`'s `SerializedRepoGraph` this reads. Structural on
 * purpose: repo-map imports `@builderforce/agent-tools/symbols`, so importing its type
 * here would make the two source packages a cycle (forbidden by the source-package graph
 * guard). A `SerializedRepoGraph` is assignable to it as-is.
 */
export interface SerializedRepoGraphShape {
    graph: {
        paths: readonly string[];
        /** Outgoing `[to, weight]` per file. */
        out: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
    };
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const byPath = <T>(m: Map<string, T>): Array<[string, T]> => [...m].sort((a, b) => compareStr(a[0], b[0]));

export function repoGraphToExtracted(graph: SerializedRepoGraphShape, rootId: string): Extracted[] {
    const { paths, out } = graph.graph;
    // FileGraph paths are unique; a malformed duplicate keeps its first row.
    const perFile = new Map<string, KEdge[]>();
    paths.forEach((path, i) => {
        if (!path || perFile.has(path)) return;
        const from = srcRef(rootId, path);
        const edges: KEdge[] = [];
        for (const [to, weight] of out[i] ?? []) {
            const target = paths[to];
            if (!target || target === path || !(weight > 0)) continue;
            edges.push({ from, to: srcRef(rootId, target), kind: 'references', weight: round6(weight), origin: 'extracted' });
        }
        perFile.set(path, edges);
    });
    return byPath(perFile).map(([path, edges]) =>
        rootLevelExtracted('repo-map', codeFileNode(rootId, path), sortEdges(edges)));
}

interface FileAcc {
    badges: Record<string, number | string>;
    edges: Map<string, KEdge>;
}

class AnalysisAcc {
    private readonly files = new Map<string, FileAcc>();

    constructor(private readonly rootId: string) {}

    file(path: string): FileAcc {
        let acc = this.files.get(path);
        if (!acc) this.files.set(path, (acc = { badges: {}, edges: new Map() }));
        return acc;
    }

    edge(fromPath: string, toPath: string, kind: string, weight: number, cycle = false): void {
        const from = srcRef(this.rootId, fromPath), to = srcRef(this.rootId, toPath);
        const edges = this.file(fromPath).edges;
        this.file(toPath);
        const id = `${to}\u0000${kind}`;
        const prior = edges.get(id);
        if (prior) {
            prior.weight += weight;
            if (cycle) prior.cycle = true;
            return;
        }
        edges.set(id, { from, to, kind, weight, origin: 'extracted', ...(cycle ? { cycle: true } : {}) });
    }

    count(path: string, badge: string): void {
        const badges = this.file(path).badges;
        badges[badge] = Number(badges[badge] ?? 0) + 1;
    }

    /** On a conflict the larger value wins — the same rule memory's badge merge applies. */
    mark(path: string, badge: string, value: string): void {
        const badges = this.file(path).badges;
        const prior = badges[badge];
        if (prior === undefined || compareStr(String(prior), value) < 0) badges[badge] = value;
    }

    result(): Extracted[] {
        return byPath(this.files).map(([path, acc]) =>
            rootLevelExtracted('code-analysis', codeFileNode(this.rootId, path, { badges: sortedBadges(acc.badges) }),
                sortEdges([...acc.edges.values()])));
    }
}

/** Lines a clone spans, at its longest location. */
function cloneLines(locations: CodeAnalysisSnapshot['issues'][number]['locations']): number {
    return Math.max(1, ...locations.map((l) => l.endLine - l.startLine + 1));
}

export function analysisToExtracted(snapshot: CodeAnalysisSnapshot, rootId: string): Extracted[] {
    const acc = new AnalysisAcc(rootId);
    for (const path of snapshot.nodes) if (path) acc.file(path);

    // dependency-cruiser: every resolved import, circular ones flagged.
    for (const e of snapshot.edges) {
        if (!e.from || !e.to) continue;
        if (e.from === e.to) { acc.file(e.from); continue; }
        acc.edge(e.from, e.to, 'references', 0, e.circular);
    }

    for (const issue of snapshot.issues) {
        const paths = [...new Set(issue.locations.map((l) => l.path).filter(Boolean))].sort(compareStr);
        switch (issue.kind) {
            case 'duplicate': {
                // jscpd: a clone group; every pair of files in it is a `duplicate` edge.
                const lines = cloneLines(issue.locations);
                for (const p of paths) acc.mark(p, CLONE_GROUP_BADGE, issue.id);
                for (let i = 0; i < paths.length; i++) {
                    for (let j = i + 1; j < paths.length; j++) acc.edge(paths[i]!, paths[j]!, 'duplicate', lines);
                }
                break;
            }
            case 'unused-file':
                for (const p of paths) acc.mark(p, CODE_BADGES.unused, 'file');
                break;
            case 'unused-export':
                for (const p of paths) acc.count(p, CODE_BADGES.unusedExports);
                break;
            case 'unused-dependency':
                for (const p of paths) acc.count(p, CODE_BADGES.unusedDependencies);
                break;
        }
    }
    return acc.result();
}

function sortEdges(edges: KEdge[]): KEdge[] {
    return edges.sort((a, b) => compareStr(a.from, b.from) || compareStr(a.to, b.to) || compareStr(a.kind, b.kind));
}

function sortedBadges(badges: Record<string, number | string>): Record<string, number | string> {
    return Object.fromEntries(Object.keys(badges).sort(compareStr).map((k) => [k, badges[k]!]));
}

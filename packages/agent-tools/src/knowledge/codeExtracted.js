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
import { CLONE_GROUP_BADGE, compareStr, srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { CODE_BADGES, codeFileNode, rootLevelExtracted } from './codeNodes.js';
import { mapYielding } from './yieldLoop.js';
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const byPath = (m) => [...m].sort((a, b) => compareStr(a[0], b[0]));
/**
 * One Extracted per file of the repo graph. Async only to yield: the per-file edge build and the per-node hash run in
 * slices of `YIELD_EVERY` files with the event loop in between (`yieldLoop.ts`), and an aborted `signal` abandons the
 * work (an empty result). The output is identical to the one-shot conversion.
 */
export async function repoGraphToExtracted(graph, rootId, signal) {
    const { paths, out } = graph.graph;
    // FileGraph paths are unique; a malformed duplicate keeps its first row.
    const perFile = new Map();
    const indexed = await mapYielding(paths, (path, i) => {
        if (!path || perFile.has(path))
            return;
        const from = srcRef(rootId, path);
        const edges = [];
        for (const [to, weight] of out[i] ?? []) {
            const target = paths[to];
            if (!target || target === path || !(weight > 0))
                continue;
            edges.push({ from, to: srcRef(rootId, target), kind: 'references', weight: round6(weight), origin: 'extracted' });
        }
        perFile.set(path, edges);
    }, signal);
    if (!indexed)
        return [];
    return (await mapYielding(byPath(perFile), ([path, edges]) => rootLevelExtracted('repo-map', codeFileNode(rootId, path), sortEdges(edges)), signal)) ?? [];
}
class AnalysisAcc {
    rootId;
    files = new Map();
    constructor(rootId) {
        this.rootId = rootId;
    }
    file(path) {
        let acc = this.files.get(path);
        if (!acc)
            this.files.set(path, (acc = { badges: {}, edges: new Map(), names: new Map() }));
        return acc;
    }
    edge(fromPath, toPath, kind, weight, cycle = false) {
        const from = srcRef(this.rootId, fromPath), to = srcRef(this.rootId, toPath);
        const edges = this.file(fromPath).edges;
        this.file(toPath);
        const id = `${to}\u0000${kind}`;
        const prior = edges.get(id);
        if (prior) {
            prior.weight += weight;
            if (cycle)
                prior.cycle = true;
            return;
        }
        edges.set(id, { from, to, kind, weight, origin: 'extracted', ...(cycle ? { cycle: true } : {}) });
    }
    count(path, badge) {
        const badges = this.file(path).badges;
        badges[badge] = Number(badges[badge] ?? 0) + 1;
    }
    /** Adds a name to the file's name-list badge (an unused export or dependency: one finding per name). */
    name(path, badge, name) {
        if (!name)
            return;
        const names = this.file(path).names;
        const set = names.get(badge) ?? new Set();
        names.set(badge, set.add(name));
    }
    /** On a conflict the larger value wins — the same rule memory's badge merge applies. */
    mark(path, badge, value) {
        const badges = this.file(path).badges;
        const prior = badges[badge];
        if (prior === undefined || compareStr(String(prior), value) < 0)
            badges[badge] = value;
    }
    /** One builder per file, in path order: the per-node hash is the cost, so the caller decides whether to yield between them. */
    rows() {
        return byPath(this.files).map(([path, acc]) => () => {
            for (const [badge, set] of acc.names)
                acc.badges[badge] = [...set].sort(compareStr).join(',');
            return rootLevelExtracted('code-analysis', codeFileNode(this.rootId, path, { badges: sortedBadges(acc.badges) }), sortEdges([...acc.edges.values()]));
        });
    }
}
/** Lines a clone spans, at its longest location. */
function cloneLines(locations) {
    return Math.max(1, ...locations.map((l) => l.endLine - l.startLine + 1));
}
/** One Extracted per file of the analysis snapshot, in one go (a report's graph in the page, the API's request). */
export function analysisToExtracted(snapshot, rootId) {
    return accumulate(snapshot, rootId).rows().map((row) => row());
}
/** The same output, yielding to the event loop between files (the code pack's conversion over a whole repo; see {@link repoGraphToExtracted}). */
export async function analysisToExtractedYielding(snapshot, rootId, signal) {
    return (await mapYielding(accumulate(snapshot, rootId).rows(), (row) => row(), signal)) ?? [];
}
function accumulate(snapshot, rootId) {
    const acc = new AnalysisAcc(rootId);
    for (const path of snapshot.nodes)
        if (path)
            acc.file(path);
    // dependency-cruiser: every resolved import, circular ones flagged.
    for (const e of snapshot.edges) {
        if (!e.from || !e.to)
            continue;
        if (e.from === e.to) {
            acc.file(e.from);
            continue;
        }
        acc.edge(e.from, e.to, 'references', 0, e.circular);
    }
    for (const issue of snapshot.issues) {
        const paths = [...new Set(issue.locations.map((l) => l.path).filter(Boolean))].sort(compareStr);
        switch (issue.kind) {
            case 'duplicate': {
                // jscpd: a clone group; every pair of files in it is a `duplicate` edge.
                const lines = cloneLines(issue.locations);
                for (const p of paths)
                    acc.mark(p, CLONE_GROUP_BADGE, issue.id);
                for (let i = 0; i < paths.length; i++) {
                    for (let j = i + 1; j < paths.length; j++)
                        acc.edge(paths[i], paths[j], 'duplicate', lines);
                }
                break;
            }
            case 'unused-file':
                for (const p of paths)
                    acc.mark(p, CODE_BADGES.unused, 'file');
                break;
            case 'unused-export':
                for (const p of paths) {
                    acc.count(p, CODE_BADGES.unusedExports);
                    acc.name(p, CODE_BADGES.unusedExportNames, issue.symbol);
                }
                break;
            case 'unused-dependency':
                for (const p of paths) {
                    acc.count(p, CODE_BADGES.unusedDependencies);
                    acc.name(p, CODE_BADGES.unusedDependencyNames, issue.symbol);
                }
                break;
        }
    }
    return acc;
}
function sortEdges(edges) {
    return edges.sort((a, b) => compareStr(a.from, b.from) || compareStr(a.to, b.to) || compareStr(a.kind, b.kind));
}
function sortedBadges(badges) {
    return Object.fromEntries(Object.keys(badges).sort(compareStr).map((k) => [k, badges[k]]));
}
//# sourceMappingURL=codeExtracted.js.map
/**
 * knowledge/workspaceAnalysis.ts — ONE perception of a workspace for the code pack (PRD 38
 * §4.5), shared by the review runner (`workspaceCodeAnalyzers`) and the PreFetch code-pack
 * executors (`dup.check`, `deps.cycles`, `deadcode.check`, `arch.boundaries`):
 *
 *   • the existing analyzer runner (`runCodeAnalysis`: dependency-cruiser, jscpd, knip);
 *   • the repo map's file reference graph (`@builderforce/repo-map`), read through the
 *     surface's own `repoRead` and fed in as `repoGraph`, so in-process graphs carry the
 *     `references` edges the API builds for linked repositories.
 *
 * Both run at most once per tree: the result is cached per sha (HEAD + a digest of the
 * dirty state — `workspaceFingerprint`), per root, folder and layer registry, with concurrent
 * askers sharing one run (stopped only when every asker has stopped). A stopped run is not
 * kept; a run with a failed analyzer, or on a tree git cannot identify (no repository), is
 * kept briefly so the actions that follow do not run the analyzers again.
 *
 * `@builderforce/repo-map` imports this package (`symbols`), so it cannot be imported here:
 * the host hands in {@link RepoGraphPort} (repo-map exports a ready one, `repoMapPort`).
 */
import { hashText } from '@seanhogg/builderforce-memory/ingest';
import { createAnalysisProgress } from './analysisProgress.js';
import { runCodeAnalysis } from './codeAnalyzers.js';
import { isSkippedPath, MAX_LISTED_FILES } from './fsDirectorySource.js';
import { reviewIgnore } from './graphIgnore.js';
import { GraphReadTally } from './graphReads.js';
import { folderPrefix, underFolder } from './rootRelative.js';
import { createShaCache } from './shaCache.js';
import { fingerprintSha, forgetWorkspaceFingerprints, workspaceFingerprint } from './workspaceFingerprint.js';
/** The bytes of any one file the repo graph reads (the map's own cap). There is no cap on the NUMBER of files. */
const MAX_GRAPH_FILE_BYTES = 256 * 1024;
/** Files read at once. */
const READ_BATCH = 16;
/** A glob, so the listing returns EVERY file — without one a big repo answers with a folder summary. */
const ALL_FILES_GLOB = '**/*';
/** How long a verdict that includes a failed analyzer is kept: its failure is usually the tree's, sometimes the network's. */
export const FAILED_RETAIN_MS = 2 * 60_000;
/** Whether (and how long) a finished analysis is worth keeping: for good when every analyzer completed, briefly when one failed, never with no snapshot. THE policy of every cache of analyses. */
export function analysisKeep(snapshot) {
    return !snapshot ? false : snapshot.tools.every((t) => t.status === 'complete') ? true : FAILED_RETAIN_MS;
}
/** What the repo graph's reads account for: the files the review lists and the repo map would read. ONE definition (the graph's own read, and a host that rebuilds the reads after a thread hop). */
export const graphAcceptsOf = (port) => (path) => !isSkippedPath(path) && port.accepts(path, 0);
/** How long an analysis of a tree git cannot identify is kept (it may change unseen). */
const UNIDENTIFIED_RETAIN_MS = 20_000;
/**
 * The repo map's file graph over `path`, read through `repoRead`; null when it cannot list files. A truncated listing gives a
 * partial graph, said so via `onWarn`. `onScope` is told the source files of the scope (the analyzers' scope too) and whether
 * the listing was cut short.
 */
export async function readRepoGraph(deps, signal) {
    const read = deps.caps.repoRead;
    const port = deps.repoGraph;
    if (!read || !port) {
        deps.progress?.plan(0);
        return null;
    }
    // Every file: the graph streams the list, so it is not held to the model-facing listing's cap.
    const listed = await read.listFiles(deps.path || undefined, ALL_FILES_GLOB, { unbounded: true }).catch(() => undefined);
    if (!listed?.ok || !listed.paths) {
        deps.progress?.plan(0);
        return null;
    }
    if (listed.truncated)
        deps.onWarn?.(`The file listing was truncated at ${listed.paths.length} files: the repo graph is partial.`);
    const prefix = folderPrefix(deps.path);
    const rootRel = (p) => underFolder(p, prefix) ?? p;
    const all = listed.paths.map((p) => p.replace(/\\/g, '/'));
    // What the review excludes (`.gitignore`, `.builderforce/ignore`) is not a file node of the map either.
    const ignored = await reviewIgnore(read, prefix, all.map(rootRel));
    const tally = new GraphReadTally();
    const paths = all.filter((p) => !isSkippedPath(p) && port.accepts(p, 0) && !ignored(rootRel(p)));
    deps.onScope?.({ files: paths.length, listingTruncated: !!listed.truncated });
    // No file-count cap: files are read in bounded concurrent batches and fed to the builder as they arrive,
    // which keeps only what it parsed (imports, symbols), so memory follows the graph, not the source.
    const builder = port.create();
    deps.progress?.plan(paths.length);
    for (let i = 0; i < paths.length; i += READ_BATCH) {
        if (signal?.aborted)
            return null;
        const batch = await Promise.all(paths.slice(i, i + READ_BATCH).map((p) => read.readFile(p).catch(() => undefined)));
        batch.forEach((file, j) => {
            const path = rootRel(paths[i + j]);
            if (!file?.ok || typeof file.content !== 'string')
                tally.skip(path, 'unreadable');
            else if (file.truncated || file.content.length > MAX_GRAPH_FILE_BYTES)
                tally.skip(path, 'too-large');
            // The listing is scope-relative to the workspace, exactly as the analyzers' paths are.
            else if (builder.addFile(paths[i + j], file.content))
                tally.read(path);
            else
                tally.skip(path, 'unsupported');
        });
        deps.progress?.filesRead(batch.length, rootRel(paths[i + batch.length - 1]));
    }
    // Which system a file is in is the systems record's to say (it detects them once); files the listing never reached it counts as unlisted.
    deps.onReads?.(tally.result(graphAcceptsOf(port)));
    return builder.build();
}
const cache = createShaCache({
    keep: (held) => (held.retainMs === 0 ? false : held.retainMs ?? true),
});
/** Forget cached analyses (tests; a host that knows the tree changed under the same sha). */
export function forgetWorkspaceAnalyses() {
    cache.clear();
    forgetWorkspaceFingerprints();
}
function partitionsDigest(partitions) {
    try {
        return partitions ? hashText(JSON.stringify(partitions)).slice(0, 12) : '-';
    }
    catch {
        return '?';
    }
}
/** Where a key is scoped: the root, the folder inside the repository, the reviewed sub-folder, the layers, the repo map. */
function scopeOf(deps, fp) {
    return [deps.rootId ?? '-', fp.prefix || '.', deps.path || '.', partitionsDigest(deps.partitions), deps.repoGraph ? 'g' : '-'];
}
/** The cache key for this tree and scope; null ⇒ the tree cannot be identified. */
export async function workspaceAnalysisKey(deps, signal) {
    const fp = await workspaceFingerprint({ caps: deps.caps, ...(signal ? { signal } : {}) });
    const sha = fingerprintSha(fp);
    return sha ? [sha, ...scopeOf(deps, fp)].join('|') : null;
}
export async function analyseWorkspace(deps, signal) {
    const fp = await workspaceFingerprint({ caps: deps.caps, ...(signal ? { signal } : {}) });
    const sha = fingerprintSha(fp);
    // An unidentifiable tree (no git) is still held briefly, per root: several actions in a row share one run.
    const key = [sha ?? '~', ...scopeOf(deps, fp)].join('|');
    const held = await cache.getOrRun(key, async (shared) => {
        const ctx = { caps: deps.caps, ...(shared ? { signal: shared } : {}) };
        let graphReads;
        const progress = createAnalysisProgress(deps.onProgress);
        // The L3 analyzer scope (deps, clones, unused) is capped at MAX_LISTED_FILES source files: over it, or with a cut-short
        // listing, the analysis is partial. The repo map itself reads every file.
        let truncated = false;
        const onScope = (scope) => {
            if (scope.listingTruncated || scope.files > MAX_LISTED_FILES)
                truncated = true;
            if (scope.files > MAX_LISTED_FILES)
                deps.onWarn?.(`The analyzer scope holds ${scope.files} files, over the cap of ${MAX_LISTED_FILES}: the analysis is marked truncated.`);
        };
        const [measured, repoGraph] = await Promise.all([
            runCodeAnalysis(ctx, {
                ...(deps.path ? { path: deps.path } : {}),
                ...(deps.partitions ? { partitions: deps.partitions } : {}),
                ...(deps.l3 ? { l3: deps.l3 } : {}),
                onToolSettled: () => progress.toolSettled(),
            }),
            readRepoGraph({ ...deps, progress, onScope, onReads: (reads) => { graphReads = reads; deps.onReads?.(reads); } }, shared),
        ]);
        // A scope over the L3 cap is a partial analysis: the record says so, and comparability (C9) holds it not comparable.
        const snapshot = measured && truncated ? { ...measured, truncated: true } : measured;
        // A run every asker stopped did not finish: it must not report done === total.
        if (!shared?.aborted)
            progress.finish();
        // A run every asker stopped is nothing: neither part is trustworthy, and none is kept.
        if (shared?.aborted)
            return { analysis: { snapshot: null, repoGraph: null }, retainMs: 0 };
        if (snapshot === null)
            return { analysis: { snapshot, repoGraph, ...(graphReads ? { graphReads } : {}) }, retainMs: 0 };
        const healthy = snapshot.tools.every((t) => t.status === 'complete');
        const retain = [healthy ? undefined : FAILED_RETAIN_MS, sha ? undefined : UNIDENTIFIED_RETAIN_MS].filter((n) => n !== undefined);
        return { analysis: { snapshot, repoGraph, ...(graphReads ? { graphReads } : {}) }, ...(retain.length ? { retainMs: Math.min(...retain) } : {}) };
    }, signal);
    // The asker who stopped gets nothing, whoever else the run served.
    return signal?.aborted ? { snapshot: null, repoGraph: null } : held.analysis;
}
//# sourceMappingURL=workspaceAnalysis.js.map
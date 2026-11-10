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
import type { AnalyzerProgress, PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';
import type { CapabilityProvider } from '../capabilities.js';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import type { AnalyzeCodebaseOptions } from '../codeAnalysisTool.js';
import { createAnalysisProgress, type AnalysisProgress } from './analysisProgress.js';
import { runCodeAnalysis } from './codeAnalyzers.js';
import type { SerializedRepoGraphShape } from './codeExtracted.js';
import { isSkippedPath, MAX_LISTED_FILES } from './fsDirectorySource.js';
import { reviewIgnore } from './graphIgnore.js';
import { GraphReadTally, type GraphFileReads } from './graphReads.js';
import { folderPrefix, underFolder } from './rootRelative.js';
import { createShaCache } from './shaCache.js';
import { fingerprintSha, forgetWorkspaceFingerprints, workspaceFingerprint, type WorkspaceFingerprint } from './workspaceFingerprint.js';

/** What the repo map offers, structurally (`RepoGraphBuilder` + `isMapCandidate`). */
export interface RepoGraphPort {
    create(): { addFile(path: string, content: string): boolean; build(): SerializedRepoGraphShape };
    accepts(path: string, size: number): boolean;
}

/** The bytes of any one file the repo graph reads (the map's own cap). There is no cap on the NUMBER of files. */
const MAX_GRAPH_FILE_BYTES = 256 * 1024;
/** Files read at once. */
const READ_BATCH = 16;
/** A glob, so the listing returns EVERY file — without one a big repo answers with a folder summary. */
const ALL_FILES_GLOB = '**/*';
/** How long a verdict that includes a failed analyzer is kept: its failure is usually the tree's, sometimes the network's. */
const FAILED_RETAIN_MS = 2 * 60_000;
/** How long an analysis of a tree git cannot identify is kept (it may change unseen). */
const UNIDENTIFIED_RETAIN_MS = 20_000;

export interface WorkspaceAnalysisDeps {
    /** The surface's capabilities — `shell` runs the analyzers, `repoRead` feeds the repo graph. */
    caps: CapabilityProvider;
    /** The knowledge root this analysis is for: part of its identity in the cache. */
    rootId?: string;
    partitions?: PartitionRegistry;
    /** Workspace-relative folder to analyse (a reviewed sub-folder); absent ⇒ the whole tree. */
    path?: string;
    /** The repo map; absent ⇒ no `references` edges (the analyzers' imports still draw the graph). */
    repoGraph?: RepoGraphPort;
    /** Told when the analysis is partial (a truncated listing). */
    onWarn?(message: string): void;
    /** Told which files the repo graph read and left out (by reason), root-relative: the systems record assigns them to systems. */
    onReads?(reads: GraphFileReads): void;
    /**
     * Progress of the run THIS call starts: repo-graph file reads plus one unit per analyzer tool. A call that
     * joins a run already in flight (see the cache) gets none.
     */
    onProgress?(progress: AnalyzerProgress): void;
    /**
     * THE L3 result cache shared with the run delta (`delta/adapters/l3Cache.ts`): the three analyzers read their result
     * for this tree from it and write fresh ones to it, under the same key and shape the run delta uses — so a delta reuses
     * this pass's results for the base commit's tree, and this pass a delta's. The in-memory per-sha cache below remains
     * only for what that store does not hold: the repo map's graph, and one shared run for concurrent askers.
     */
    l3?: AnalyzeCodebaseOptions['l3'];
}

export interface WorkspaceAnalysis {
    snapshot: CodeAnalysisSnapshot | null;
    repoGraph: SerializedRepoGraphShape | null;
    /** Which files the repo graph read, and skipped by reason (absent when no graph was read). */
    graphReads?: GraphFileReads;
}

/**
 * The repo map's file graph over `path`, read through `repoRead`; null when it cannot list files. A truncated listing gives a
 * partial graph, said so via `onWarn`. `onScope` is told the source files of the scope (the analyzers' scope too) and whether
 * the listing was cut short.
 */
export async function readRepoGraph(
    deps: Pick<WorkspaceAnalysisDeps, 'caps' | 'path' | 'repoGraph' | 'onWarn' | 'onReads'> & {
        progress?: AnalysisProgress;
        onScope?(scope: { files: number; listingTruncated: boolean }): void;
    },
    signal?: AbortSignal,
): Promise<SerializedRepoGraphShape | null> {
    const read = deps.caps.repoRead;
    const port = deps.repoGraph;
    if (!read || !port) { deps.progress?.plan(0); return null; }
    // Every file: the graph streams the list, so it is not held to the model-facing listing's cap.
    const listed = await read.listFiles(deps.path || undefined, ALL_FILES_GLOB, { unbounded: true }).catch(() => undefined);
    if (!listed?.ok || !listed.paths) { deps.progress?.plan(0); return null; }
    if (listed.truncated) deps.onWarn?.(`The file listing was truncated at ${listed.paths.length} files: the repo graph is partial.`);
    const prefix = folderPrefix(deps.path);
    const rootRel = (p: string): string => underFolder(p, prefix) ?? p;
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
        if (signal?.aborted) return null;
        const batch = await Promise.all(paths.slice(i, i + READ_BATCH).map((p) => read.readFile(p).catch(() => undefined)));
        batch.forEach((file, j) => {
            const path = rootRel(paths[i + j]!);
            if (!file?.ok || typeof file.content !== 'string') tally.skip(path, 'unreadable');
            else if (file.truncated || file.content.length > MAX_GRAPH_FILE_BYTES) tally.skip(path, 'too-large');
            // The listing is scope-relative to the workspace, exactly as the analyzers' paths are.
            else if (builder.addFile(paths[i + j]!, file.content)) tally.read(path);
            else tally.skip(path, 'unsupported');
        });
        deps.progress?.filesRead(batch.length, rootRel(paths[i + batch.length - 1]!));
    }
    // Which system a file is in is the systems record's to say (it detects them once); files the listing never reached it counts as unlisted.
    deps.onReads?.(tally.result((p) => !isSkippedPath(p) && port.accepts(p, 0)));
    return builder.build();
}

/** What the cache holds: the analysis, and how long it is worth holding. */
interface Held {
    analysis: WorkspaceAnalysis;
    /** undefined ⇒ for good (the key is the content); 0 ⇒ not at all. */
    retainMs?: number;
}

const cache = createShaCache<Held>({
    keep: (held) => (held.retainMs === 0 ? false : held.retainMs ?? true),
});

/** Forget cached analyses (tests; a host that knows the tree changed under the same sha). */
export function forgetWorkspaceAnalyses(): void {
    cache.clear();
    forgetWorkspaceFingerprints();
}

function partitionsDigest(partitions: PartitionRegistry | undefined): string {
    try { return partitions ? hashText(JSON.stringify(partitions)).slice(0, 12) : '-'; } catch { return '?'; }
}

/** Where a key is scoped: the root, the folder inside the repository, the reviewed sub-folder, the layers, the repo map. */
function scopeOf(deps: WorkspaceAnalysisDeps, fp: Pick<WorkspaceFingerprint, 'prefix'>): string[] {
    return [deps.rootId ?? '-', fp.prefix || '.', deps.path || '.', partitionsDigest(deps.partitions), deps.repoGraph ? 'g' : '-'];
}

/** The cache key for this tree and scope; null ⇒ the tree cannot be identified. */
export async function workspaceAnalysisKey(deps: WorkspaceAnalysisDeps, signal?: AbortSignal): Promise<string | null> {
    const fp = await workspaceFingerprint({ caps: deps.caps, ...(signal ? { signal } : {}) });
    const sha = fingerprintSha(fp);
    return sha ? [sha, ...scopeOf(deps, fp)].join('|') : null;
}

export async function analyseWorkspace(deps: WorkspaceAnalysisDeps, signal?: AbortSignal): Promise<WorkspaceAnalysis> {
    const fp = await workspaceFingerprint({ caps: deps.caps, ...(signal ? { signal } : {}) });
    const sha = fingerprintSha(fp);
    // An unidentifiable tree (no git) is still held briefly, per root: several actions in a row share one run.
    const key = [sha ?? '~', ...scopeOf(deps, fp)].join('|');
    const held = await cache.getOrRun(key, async (shared) => {
        const ctx = { caps: deps.caps, ...(shared ? { signal: shared } : {}) };
        let graphReads: GraphFileReads | undefined;
        const progress = createAnalysisProgress(deps.onProgress);
        // The L3 analyzer scope (deps, clones, unused) is capped at MAX_LISTED_FILES source files: over it, or with a cut-short
        // listing, the analysis is partial. The repo map itself reads every file.
        let truncated = false;
        const onScope = (scope: { files: number; listingTruncated: boolean }): void => {
            if (scope.listingTruncated || scope.files > MAX_LISTED_FILES) truncated = true;
            if (scope.files > MAX_LISTED_FILES) deps.onWarn?.(`The analyzer scope holds ${scope.files} files, over the cap of ${MAX_LISTED_FILES}: the analysis is marked truncated.`);
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
        const snapshot = measured && truncated ? { ...measured, truncated: true as const } : measured;
        // A run every asker stopped did not finish: it must not report done === total.
        if (!shared?.aborted) progress.finish();
        // A run every asker stopped is nothing: neither part is trustworthy, and none is kept.
        if (shared?.aborted) return { analysis: { snapshot: null, repoGraph: null }, retainMs: 0 };
        if (snapshot === null) return { analysis: { snapshot, repoGraph, ...(graphReads ? { graphReads } : {}) }, retainMs: 0 };
        const healthy = snapshot.tools.every((t) => t.status === 'complete');
        const retain = [healthy ? undefined : FAILED_RETAIN_MS, sha ? undefined : UNIDENTIFIED_RETAIN_MS].filter((n): n is number => n !== undefined);
        return { analysis: { snapshot, repoGraph, ...(graphReads ? { graphReads } : {}) }, ...(retain.length ? { retainMs: Math.min(...retain) } : {}) };
    }, signal);
    // The asker who stopped gets nothing, whoever else the run served.
    return signal?.aborted ? { snapshot: null, repoGraph: null } : held.analysis;
}

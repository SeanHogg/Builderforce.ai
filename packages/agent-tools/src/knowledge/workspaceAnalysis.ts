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
 * dirty state — `workspaceFingerprint`), per scope and per layer registry, with concurrent
 * askers sharing one run. A run with a failed analyzer, or stopped, is not kept.
 *
 * `@builderforce/repo-map` imports this package (`symbols`), so it cannot be imported here:
 * the host hands in {@link RepoGraphPort} (repo-map exports a ready one, `repoMapPort`).
 */

import { hashText } from '@seanhogg/builderforce-memory/ingest';
import type { PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';
import type { CapabilityProvider } from '../capabilities.js';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { runCodeAnalysis } from './codeAnalyzers.js';
import type { SerializedRepoGraphShape } from './codeExtracted.js';
import { createShaCache } from './shaCache.js';
import { fingerprintSha, workspaceFingerprint } from './workspaceFingerprint.js';

/** What the repo map offers, structurally (`RepoGraphBuilder` + `isMapCandidate`). */
export interface RepoGraphPort {
    create(): { addFile(path: string, content: string): boolean; build(): SerializedRepoGraphShape };
    accepts(path: string, size: number): boolean;
}

/** Files the repo graph reads at most, and the bytes of any one (the map's own caps). */
const MAX_GRAPH_FILES = 6_000;
const MAX_GRAPH_FILE_BYTES = 256 * 1024;
/** Files read at once. */
const READ_BATCH = 16;

export interface WorkspaceAnalysisDeps {
    /** The surface's capabilities — `shell` runs the analyzers, `repoRead` feeds the repo graph. */
    caps: CapabilityProvider;
    partitions?: PartitionRegistry;
    /** Workspace-relative folder to analyse (a reviewed sub-folder); absent ⇒ the whole tree. */
    path?: string;
    /** The repo map; absent ⇒ no `references` edges (the analyzers' imports still draw the graph). */
    repoGraph?: RepoGraphPort;
}

export interface WorkspaceAnalysis {
    snapshot: CodeAnalysisSnapshot | null;
    repoGraph: SerializedRepoGraphShape | null;
}

/** The repo map's file graph over `path`, read through `repoRead`; null when it cannot list files. */
export async function readRepoGraph(
    deps: Pick<WorkspaceAnalysisDeps, 'caps' | 'path' | 'repoGraph'>,
    signal?: AbortSignal,
): Promise<SerializedRepoGraphShape | null> {
    const read = deps.caps.repoRead;
    const port = deps.repoGraph;
    if (!read || !port) return null;
    const listed = await read.listFiles(deps.path || undefined).catch(() => undefined);
    if (!listed?.ok || !listed.paths) return null;
    const builder = port.create();
    const paths = listed.paths.map((p) => p.replace(/\/g, '/')).filter((p) => port.accepts(p, 0)).slice(0, MAX_GRAPH_FILES);
    for (let i = 0; i < paths.length; i += READ_BATCH) {
        if (signal?.aborted) return null;
        const batch = await Promise.all(paths.slice(i, i + READ_BATCH).map((p) => read.readFile(p).catch(() => undefined)));
        batch.forEach((file, j) => {
            if (file?.ok && typeof file.content === 'string' && !file.truncated && file.content.length <= MAX_GRAPH_FILE_BYTES) {
                // The listing is scope-relative to the workspace, exactly as the analyzers' paths are.
                builder.addFile(paths[i + j]!, file.content);
            }
        });
    }
    return builder.build();
}

const cache = createShaCache<WorkspaceAnalysis>({
    keep: (a) => a.snapshot !== null && a.snapshot.tools.every((t) => t.status === 'complete'),
});

/** Forget cached analyses (tests; a host that knows the tree changed under the same sha). */
export function forgetWorkspaceAnalyses(): void {
    cache.clear();
}

function partitionsDigest(partitions: PartitionRegistry | undefined): string {
    try { return partitions ? hashText(JSON.stringify(partitions)).slice(0, 12) : '-'; } catch { return '?'; }
}

/** The cache key for this tree and scope; null ⇒ the tree cannot be identified (never cached). */
export async function workspaceAnalysisKey(deps: WorkspaceAnalysisDeps, signal?: AbortSignal): Promise<string | null> {
    const sha = fingerprintSha(await workspaceFingerprint({ caps: deps.caps, ...(signal ? { signal } : {}) }));
    return sha ? [sha, deps.path || '.', partitionsDigest(deps.partitions), deps.repoGraph ? 'g' : '-'].join('|') : null;
}

export async function analyseWorkspace(deps: WorkspaceAnalysisDeps, signal?: AbortSignal): Promise<WorkspaceAnalysis> {
    const key = await workspaceAnalysisKey(deps, signal);
    return cache.getOrRun(key, async () => {
        const ctx = { caps: deps.caps, ...(signal ? { signal } : {}) };
        const [snapshot, repoGraph] = await Promise.all([
            runCodeAnalysis(ctx, { ...(deps.path ? { path: deps.path } : {}), ...(deps.partitions ? { partitions: deps.partitions } : {}) }),
            readRepoGraph(deps, signal),
        ]);
        // A stopped run is nothing: neither part is trustworthy, and none is kept.
        return signal?.aborted ? { snapshot: null, repoGraph: null } : { snapshot, repoGraph };
    });
}

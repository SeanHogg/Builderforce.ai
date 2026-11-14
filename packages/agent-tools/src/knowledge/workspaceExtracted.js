/**
 * knowledge/workspaceExtracted.ts — the WHOLE of a workspace's code perception as plain data: `analyseWorkspace` (the
 * analyzers + the repo graph) followed by the conversion to root-level `Extracted` (`codeAnalyzers.ts`). It is the unit a
 * host may run off its main thread: the input is data and a few closures (see {@link WorkspaceAnalysisDeps}), the output
 * ({@link WorkspaceExtracted}) is structured-cloneable, so a worker posts it back as is.
 *
 * ONE function for every caller — the review's analyzers (`workspaceCodeAnalyzers`), the background indexer's L3 pass and the
 * PreFetch code actions — whether it runs in a worker (the VS Code extension's L3 worker rebuilds the deps from data and calls
 * this) or in this thread (every other host, and the fallback). The host-specific part is only WHERE it runs: a
 * {@link WorkspaceExtractedRunner}.
 *
 * Host-agnostic: no `worker_threads`, no `vscode`.
 */
import { extractedOf } from './codeAnalyzers.js';
import { repoGraphEdgeCount } from './reviewRecord.js';
import { repoGraphUnder, snapshotUnder } from './rootRelative.js';
import { analyseWorkspace } from './workspaceAnalysis.js';
/** The analysis and its conversion, in THIS thread (cooperatively yielding). `deps.rootId` names the root. */
export async function analyseWorkspaceExtracted(deps, signal) {
    const { snapshot, repoGraph, graphReads } = await analyseWorkspace(deps, signal);
    // The analyzers name files relative to the workspace; this root's files (its manifest, its refs) are relative to the root itself.
    const scoped = snapshot && deps.path ? snapshotUnder(snapshot, deps.path) : snapshot;
    const graph = repoGraph && deps.path ? repoGraphUnder(repoGraph, deps.path) : repoGraph;
    const extracted = signal?.aborted ? [] : await extractedOf({ analysis: scoped, repoGraph: graph }, deps.rootId, signal);
    return {
        extracted,
        snapshot: scoped,
        ...(repoGraph ? { edges: repoGraphEdgeCount(repoGraph) } : {}),
        ...(graphReads ? { graphReads } : {}),
    };
}
//# sourceMappingURL=workspaceExtracted.js.map
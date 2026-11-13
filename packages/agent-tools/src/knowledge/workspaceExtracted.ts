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

import type { AnalyzerProgress, Extracted } from '@seanhogg/builderforce-memory/knowledge';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { extractedOf } from './codeAnalyzers.js';
import type { GraphFileReads } from './graphReads.js';
import { repoGraphEdgeCount } from './reviewRecord.js';
import { repoGraphUnder, snapshotUnder } from './rootRelative.js';
import { analyseWorkspace, type WorkspaceAnalysisDeps } from './workspaceAnalysis.js';

export interface WorkspaceExtracted {
    /** The code pack's root-level output, relative to the analysed root. */
    extracted: Extracted[];
    /** The analyzers' snapshot, relative to the analysed root (what a linked host uploads); null when none ran. */
    snapshot: CodeAnalysisSnapshot | null;
    /** Import edges of the workspace's repo graph (the sync panel's local edges); absent when no graph was read. */
    edges?: number;
    /** Which files the repo graph read and skipped, by reason (the systems record's input). */
    graphReads?: GraphFileReads;
}

/** What a run reports while it works: the asker's own signal and its two callbacks. */
export interface WorkspaceExtractedHooks {
    signal?: AbortSignal;
    onProgress?(progress: AnalyzerProgress): void;
    onWarn?(message: string): void;
}

/** Runs one workspace analysis for a root — wherever the host runs it (a worker, or this thread). */
export type WorkspaceExtractedRunner = (rootId: string, hooks: WorkspaceExtractedHooks) => Promise<WorkspaceExtracted>;

/** The analysis and its conversion, in THIS thread (cooperatively yielding). `deps.rootId` names the root. */
export async function analyseWorkspaceExtracted(deps: WorkspaceAnalysisDeps & { rootId: string }, signal?: AbortSignal): Promise<WorkspaceExtracted> {
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

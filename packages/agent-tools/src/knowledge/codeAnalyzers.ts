/**
 * knowledge/codeAnalyzers.ts — the code pack's `AnalyzerPort` (PRD 38 §4.5).
 *
 * The analyzers are NOT run here and never re-implemented: the host's `run` executes the
 * existing runner (`analyze_codebase` — dependency-cruiser, jscpd, knip — through the
 * surface's shell capability, cached per sha by the host; on web hosts it returns the last
 * uploaded snapshot) and, where it has one, the repo map's serialized file graph. This
 * port only converts that output into root-level `Extracted`.
 *
 * Pure: the shell is reached only through the injected {@link ToolContext}. Worker-safe.
 */

import type { AnalyzerPort, AnalyzerProgress, Extracted, PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { createAnalyzeCodebaseTool, type AnalyzeCodebaseOptions } from '../codeAnalysisTool.js';
import type { ToolContext } from '../tool.js';
import { analysisToExtracted, repoGraphToExtracted, type SerializedRepoGraphShape } from './codeExtracted.js';

/** What one analyzer run hands back. Either part may be absent (no shell, no map). */
export interface CodeAnalysisRun {
    analysis?: CodeAnalysisSnapshot | null;
    repoGraph?: SerializedRepoGraphShape | null;
}

export interface CodeAnalyzersDeps {
    run(rootId: string, signal?: AbortSignal, onProgress?: (p: AnalyzerProgress) => void): Promise<CodeAnalysisRun>;
}

export function codeAnalyzers(deps: CodeAnalyzersDeps): AnalyzerPort {
    return {
        async analyse(rootId: string, signal?: AbortSignal, onProgress?: (p: AnalyzerProgress) => void): Promise<Extracted[]> {
            const run = await deps.run(rootId, signal, onProgress);
            return [
                ...(run.repoGraph ? repoGraphToExtracted(run.repoGraph, rootId) : []),
                ...(run.analysis ? analysisToExtracted(run.analysis, rootId) : []),
            ];
        },
    };
}

/**
 * Runs the existing `analyze_codebase` runner on a surface with a shell, with the layer
 * rules handed to dependency-cruiser when `partitions` is given. The snapshot, or null
 * when the runner refused the scope.
 */
export async function runCodeAnalysis(
    ctx: ToolContext,
    opts: { path?: string; partitions?: PartitionRegistry; onToolSettled?(): void; l3?: AnalyzeCodebaseOptions['l3'] } = {},
): Promise<CodeAnalysisSnapshot | null> {
    const tool = createAnalyzeCodebaseTool({
        ...(opts.partitions ? { partitions: opts.partitions } : {}),
        ...(opts.onToolSettled ? { onToolSettled: opts.onToolSettled } : {}),
        ...(opts.l3 ? { l3: opts.l3 } : {}),
    });
    const result = await tool.execute(opts.path ? { path: opts.path } : {}, ctx);
    const snapshot = result.data['snapshot'];
    return snapshot && typeof snapshot === 'object' ? (snapshot as CodeAnalysisSnapshot) : null;
}

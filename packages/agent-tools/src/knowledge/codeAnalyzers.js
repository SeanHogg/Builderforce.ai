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
import { createAnalyzeCodebaseTool } from '../codeAnalysisTool.js';
import { analysisToExtractedYielding, repoGraphToExtracted } from './codeExtracted.js';
/** The root-level `Extracted` of one analyzer run (the repo graph's, then the analyzers'); yields between files. */
export async function extractedOf(run, rootId, signal) {
    const graph = run.repoGraph && !signal?.aborted ? await repoGraphToExtracted(run.repoGraph, rootId, signal) : [];
    const analysis = run.analysis && !signal?.aborted ? await analysisToExtractedYielding(run.analysis, rootId, signal) : [];
    // A stopped conversion is abandoned whole: never half the rows.
    return signal?.aborted ? [] : [...graph, ...analysis];
}
export function codeAnalyzers(deps) {
    return {
        async analyse(rootId, signal, onProgress) {
            return extractedOf(await deps.run(rootId, signal, onProgress), rootId, signal);
        },
    };
}
/**
 * Runs the existing `analyze_codebase` runner on a surface with a shell, with the layer
 * rules handed to dependency-cruiser when `partitions` is given. The snapshot, or null
 * when the runner refused the scope.
 */
export async function runCodeAnalysis(ctx, opts = {}) {
    const tool = createAnalyzeCodebaseTool({
        ...(opts.partitions ? { partitions: opts.partitions } : {}),
        ...(opts.onToolSettled ? { onToolSettled: opts.onToolSettled } : {}),
        ...(opts.l3 ? { l3: opts.l3 } : {}),
    });
    const result = await tool.execute(opts.path ? { path: opts.path } : {}, ctx);
    const snapshot = result.data['snapshot'];
    return snapshot && typeof snapshot === 'object' ? snapshot : null;
}
//# sourceMappingURL=codeAnalyzers.js.map
/**
 * THE host-side cache of L3 analyses, in front of the worker: every analysis in the VSIX (a review, the background indexer's L3
 * pass, the chat prefetch code actions) goes through {@link sharedAnalysis}, so ONE analysis serves them all while the tree is
 * unchanged — the per-sha sharing `analyseWorkspace` gives an in-thread run, which a one-job worker cannot (it has no memory of
 * the last job). Keyed by the SAME `workspaceAnalysisKey`, kept by the SAME policy (`analysisKeep`); a stopped run is not kept,
 * and concurrent askers share one worker, stopped only when every asker has stopped.
 */

import { analysisKeep, createShaCache, workspaceAnalysisKey, type WorkspaceExtracted, type WorkspaceExtractedHooks } from "@builderforce/agent-tools/knowledge";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import { repoMapPort } from "@builderforce/repo-map";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { runL3InWorker } from "./l3Worker";
import type { L3Job } from "./l3WorkerJob";

const cache = createShaCache<WorkspaceExtracted>({ max: 2, keep: (held) => analysisKeep(held.snapshot) });

/** One local provider per folder, for the cache key's git reads (a fresh one per call would lose its fingerprint memo). */
const capsOf = new Map<string, CapabilityProvider>();
const capsFor = (folder: string): CapabilityProvider => {
  let caps = capsOf.get(folder);
  if (!caps) capsOf.set(folder, (caps = buildLocalCapabilityProvider(folder)));
  return caps;
};

/** The analysis of `job`, from the worker, shared per tree. Progress and warnings reach only the asker whose run it is. */
export async function sharedAnalysis(job: L3Job, hooks: WorkspaceExtractedHooks = {}): Promise<WorkspaceExtracted> {
  const key = await workspaceAnalysisKey({
    caps: capsFor(job.folderPath), rootId: job.rootId, repoGraph: repoMapPort,
    ...(job.path ? { path: job.path } : {}), ...(job.partitions ? { partitions: job.partitions } : {}),
  }, hooks.signal);
  const result = await cache.getOrRun(key, (shared) => runL3InWorker(job, { ...hooks, ...(shared ? { signal: shared } : {}) }), hooks.signal);
  // The asker who stopped gets nothing, whoever else the run served.
  return hooks.signal?.aborted ? { extracted: [], snapshot: null } : result;
}

/** Forget the shared analyses (tests). */
export function forgetSharedAnalyses(): void {
  cache.clear();
}

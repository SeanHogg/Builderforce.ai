/**
 * THE host-side cache of L3 analyses, in front of the worker: every analysis in the VSIX (a review, the background indexer's L3
 * pass, the chat prefetch code actions) goes through {@link sharedAnalysis}, so ONE analysis serves them all while the tree is
 * unchanged — the per-sha sharing `analyseWorkspace` gives an in-thread run, which a one-job worker cannot (it has no memory of
 * the last job). Keyed by the SAME `workspaceAnalysisKey`, kept by the SAME policy (`analysisKeep`); a stopped run is not kept,
 * and concurrent askers share one worker, stopped only when every asker has stopped.
 *
 * Being the one door to the worker, it is also where the crash guard sits (`l3CrashGuard.ts`): every analysis that starts a
 * worker — a review, the indexer's requested L3 pass, a code action — persists its in-flight sentinel first, so a pass that
 * takes the host down is never started again on its own for the same tree.
 */

import { analysisKeep, createShaCache, workspaceAnalysisKey, type WorkspaceExtracted, type WorkspaceExtractedHooks } from "@builderforce/agent-tools/knowledge";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import { repoMapPort } from "@builderforce/repo-map";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { recentCommits } from "@builderforce/agent-tools/node-git-history";
import { l3CrashGuard, l3GuardIds, L3Quarantined } from "./l3CrashGuard";
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

/** The tree's commit, for the crash guard; null when git cannot name it. */
const headOf = async (folder: string): Promise<string | null> => (await recentCommits(folder, 1).catch(() => []))[0]?.sha ?? null;

/**
 * A run that really starts a worker (a cache miss), under the root's crash guard (`l3CrashGuard.ts`): refused while the root is
 * quarantined; the in-flight sentinel is persisted before the worker starts and cleared when it ends, whatever the outcome.
 */
async function guarded(job: L3Job, run: () => Promise<WorkspaceExtracted>): Promise<WorkspaceExtracted> {
  const [own, ...outer] = l3GuardIds(job.rootId, job.path);
  const guard = l3CrashGuard(own!);
  const sha = await headOf(job.folderPath);
  // A sub-folder root is held off by its folder's quarantine too (its own is checked by `begin`).
  for (const id of outer) {
    const reason = await l3CrashGuard(id).blocked(sha);
    if (reason) throw new L3Quarantined(`l3_quarantined: ${reason}`);
  }
  await guard.begin(sha);
  try {
    const result = await run();
    await guard.end(sha);
    return result;
  } catch (error) {
    await guard.end(sha, error);
    throw error;
  }
}

/** The analysis of `job`, from the worker, shared per tree. Progress and warnings reach only the asker whose run it is. */
export async function sharedAnalysis(job: L3Job, hooks: WorkspaceExtractedHooks = {}): Promise<WorkspaceExtracted> {
  const key = await workspaceAnalysisKey({
    caps: capsFor(job.folderPath), rootId: job.rootId, repoGraph: repoMapPort,
    ...(job.path ? { path: job.path } : {}), ...(job.partitions ? { partitions: job.partitions } : {}),
  }, hooks.signal);
  const result = await cache.getOrRun(key, (shared) => guarded(job, () => runL3InWorker(job, { ...hooks, ...(shared ? { signal: shared } : {}) })), hooks.signal);
  // The asker who stopped gets nothing, whoever else the run served.
  return hooks.signal?.aborted ? { extracted: [], snapshot: null } : result;
}

/** Forget the shared analyses (tests). */
export function forgetSharedAnalyses(): void {
  cache.clear();
}

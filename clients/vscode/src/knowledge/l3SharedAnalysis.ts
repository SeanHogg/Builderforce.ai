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
import { takeFreshTicket } from "./l3FreshHold";
import { runL3InWorker } from "./l3Worker";
import type { L3Job } from "./l3WorkerJob";

/** The retry's hold lives beside the door it opens (`l3FreshHold.ts`); its holders (`indexHostPorts.ts`) take it from here. */
export { holdFreshAnalysis } from "./l3FreshHold";

/** Whether (and how long) the cache keeps a finished analysis. */
const keepOf = (held: WorkspaceExtracted): boolean | number => analysisKeep(held.snapshot);
const cache = createShaCache<WorkspaceExtracted>({ max: 2, keep: keepOf });

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
  const folder = job.folderPath.replace(/\\/g, "/");
  // A sub-folder root is held off by its folder's quarantine too (its own is checked by `begin`).
  for (const id of outer) {
    const reason = await l3CrashGuard(id).blocked(sha, folder);
    if (reason) throw new L3Quarantined(`l3_quarantined: ${reason}`);
  }
  await guard.begin(sha, job.path ? `${folder}/${job.path}` : folder);
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
  // A root held fresh (the person asked to analyse again, `l3FreshHold.ts`): the first ask of this key under the hold runs the
  // worker whatever either cache holds (the job's `fresh`: the on-disk one too) and REPLACES the entry under the real key;
  // other asks of the key meanwhile join that run. No await between taking the ticket and registering the run.
  const ticket = takeFreshTicket(job.rootId, key, !!job.l3RootPath);
  const run: L3Job = ticket ? { ...job, fresh: true } : job;
  const work = async (shared?: AbortSignal): Promise<WorkspaceExtracted> => {
    // Every asker stopped: the cache drops the entry now, and the ticket goes back with it (not when the worker settles).
    if (shared?.aborted) ticket?.reopen();
    else shared?.addEventListener("abort", () => ticket?.reopen(), { once: true });
    try {
      const result = await guarded(run, () => runL3InWorker(run, { ...hooks, ...(shared ? { signal: shared } : {}) }));
      // A result the cache drops leaves no entry to join: the next ask of the key under the hold must run fresh again.
      if (keepOf(result) === false) ticket?.reopen();
      return result;
    } catch (error) {
      ticket?.reopen();
      throw error;
    }
  };
  const result = await cache.getOrRun(key, work, hooks.signal, ticket ? { fresh: true } : undefined);
  // The asker who stopped gets nothing, whoever else the run served.
  return hooks.signal?.aborted ? { extracted: [], snapshot: null } : result;
}

/** Forget the shared analyses (tests). */
export function forgetSharedAnalyses(): void {
  cache.clear();
}

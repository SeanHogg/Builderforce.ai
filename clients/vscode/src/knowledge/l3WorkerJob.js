/**
 * One L3 analysis job as PLAIN DATA, and the function that runs it — the body of the L3 worker (`l3WorkerEntry.ts`) and the
 * in-thread fallback of the worker host (`l3Worker.ts`, no worker file in a test or a dev run): the ports are rebuilt from data
 * (the folder, the layers, whether the L3 result cache is bound) and handed to the shared `analyseWorkspaceExtracted`.
 *
 * Runs inside a `worker_threads` worker, so nothing here (nor anything it imports) may reach `vscode`: the local capability
 * provider, the L3 cache binding and the repo map are all node-only.
 */
import { analyseWorkspaceExtracted, graphAcceptsOf } from "@builderforce/agent-tools/knowledge";
import { repoMapPort } from "@builderforce/repo-map";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { indexerL3Binding } from "../runDelta/analyzers/l3Binding";
/** The analysis of `job`, in THIS thread: the ONE implementation the worker and the fallback share. */
export function runL3Job(job, hooks = {}) {
    return analyseWorkspaceExtracted({
        caps: buildLocalCapabilityProvider(job.folderPath),
        rootId: job.rootId,
        repoGraph: repoMapPort,
        ...(job.l3RootPath ? { l3: indexerL3Binding(job.l3RootPath) } : {}),
        ...(job.path ? { path: job.path } : {}),
        ...(job.partitions ? { partitions: job.partitions } : {}),
        ...(hooks.onWarn ? { onWarn: hooks.onWarn } : {}),
        ...(hooks.onProgress ? { onProgress: hooks.onProgress } : {}),
    }, hooks.signal);
}
/** The result as plain data for `postMessage`: the graph reads' `accepts` is a function (the repo map's policy), which a worker cannot send. */
export function portableResult(result) {
    if (!result.graphReads?.accepts)
        return result;
    const { accepts: _policy, ...reads } = result.graphReads;
    return { ...result, graphReads: reads };
}
/** The inverse, on the receiving thread: the repo map's policy is put back on the reads the worker sent. */
export function rehydratedResult(result) {
    return result.graphReads ? { ...result, graphReads: { ...result.graphReads, accepts: graphAcceptsOf(repoMapPort) } } : result;
}
//# sourceMappingURL=l3WorkerJob.js.map
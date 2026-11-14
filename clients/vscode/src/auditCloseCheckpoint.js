import { closeLocalAuditRun, getLocalAuditRun, recoverInterruptedAuditRuns, } from "./localAuditStore";
function hasAccount(accountId) {
    return typeof accountId === "string" && accountId.trim().length > 0;
}
function checkpointOf(input) {
    return {
        auditId: input.auditId,
        projectId: input.projectId,
        requestId: input.requestId,
        status: "completed",
        launchCloud: false,
        closedLocally: true,
    };
}
function nextStartOf(input) {
    return {
        auditId: input.auditId,
        projectId: input.projectId,
        requestId: input.requestId,
        status: "interrupted",
        launchCloud: false,
        kind: "next-start",
    };
}
/**
 * Plan what close may persist. The return value never launches cloud work.
 *
 * A request to launch cloud without an account, or without `dispatchAllowed`,
 * is refused before any local write is planned — close must not become a
 * silent cloud start. Otherwise a finished run is a local completion, and a
 * host close of an unfinished run is a local next-start job.
 */
export function planAuditClose(input) {
    if (input.launchCloud === true) {
        if (!hasAccount(input.accountId)) {
            return { action: "refuse-cloud", reason: "missing-account" };
        }
        if (input.dispatchAllowed !== true) {
            return { action: "refuse-cloud", reason: "dispatch-not-allowed" };
        }
        // Identity and permission exist, but this close still does not launch.
        // A later cloud job is a separate, explicit dispatch — not a close side effect.
    }
    if (input.runFinished) {
        return { action: "complete-local", checkpoint: checkpointOf(input) };
    }
    // Host shutdown of an unfinished run, and any close that is not a local
    // completion, stay interrupted. Never mark them completed, and never launch.
    return { action: "defer-local", job: nextStartOf(input) };
}
/**
 * A locally complete audit must not launch cloud work, even when a later
 * caller would otherwise be allowed to. Anything not closed locally is not
 * this refusal.
 */
export function refuseCloudLaunch(record) {
    if (record?.record?.payload.closedLocally === true) {
        return { launch: false, reason: "locally_complete" };
    }
    return { launch: true };
}
/** Read the close record. A new store loaded from the same snapshot is a restart. */
export async function readClosedAudit(store, runId) {
    return (await getLocalAuditRun(store, runId)) ?? null;
}
/**
 * Close writes a durable local-complete record and refuses cloud launch.
 * `recoverInterruptedAuditRuns` is called from this close path, not from extension.ts.
 */
export async function closeAuditLocally(input) {
    const fixedNow = input.now;
    const deps = {
        deviceId: input.deviceId,
        ...(fixedNow ? { now: () => new Date(fixedNow) } : {}),
    };
    await recoverInterruptedAuditRuns(input.store, deps);
    const source = { ...input.source };
    await closeLocalAuditRun(input.store, deps, {
        auditId: input.auditId,
        projectId: input.projectId,
        runId: input.runId,
        source,
    });
    const record = await getLocalAuditRun(input.store, input.runId);
    if (!record)
        throw new Error("local_complete_missing");
    const cloud = refuseCloudLaunch(record);
    if (cloud.launch)
        throw new Error("locally_complete_refused");
    return { record, cloud };
}
//# sourceMappingURL=auditCloseCheckpoint.js.map
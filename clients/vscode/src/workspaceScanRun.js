/**
 * The workspace scan's run (PRD 41 A4): the deterministic part ALWAYS runs. Only the optional
 * overview needs a model route; with none (no local model, no specific model, no key for a route
 * that needs sign-in) the overview is omitted and marked `skipped / no-model-route`, and the
 * agent is grounded on the deterministic map. There are no early returns before the scan.
 *
 * One scan per root at a time: a call while one runs coalesces onto it, and a FORCED call queues at most
 * one trailing forced scan (every further forced call shares it).
 *
 * Ports are injected so the signed-out path is testable without the extension host.
 */
const flights = new Map();
function launch(root, ports, force) {
    const flight = { done: Promise.resolve() };
    flight.done = scanOnce(root, ports, force).finally(() => { if (flights.get(root) === flight)
        flights.delete(root); });
    flights.set(root, flight);
    return flight.done;
}
export function runWorkspaceScan(ports, force) {
    const root = ports.root();
    if (!root)
        return Promise.resolve();
    const running = flights.get(root);
    if (!running)
        return launch(root, ports, force);
    if (!force)
        return running.done;
    running.trailing ??= running.done.then(() => launch(root, ports, true));
    return running.trailing;
}
/** True when a cached scan skipped the overview for want of a route (it is stale once a route is usable). */
function skippedForNoRoute(scan) {
    return scan.overviewStatus?.status === "skipped" && scan.overviewStatus.reason === "no-model-route";
}
async function scanOnce(root, ports, force) {
    // Hand the folder to Builderforce Desktop so its index starts now: the local index needs no account.
    ports.registerWorkspace(root);
    // The definition-index refresh is UNGATED: no model, no account, no key.
    void ports.refreshSymbolIndex(root).catch((e) => ports.error("BuilderForce symbol index refresh failed:", e));
    // The route reads the inference mode, which is only real once the policy resolved.
    await ports.policyResolved();
    const key = await ports.key();
    const route = await ports.resolveRoute();
    const noModel = ports.noModelReason(route);
    const usable = !noModel && (!!key || !ports.routeRequiresSignIn(route));
    if (!usable && force && noModel)
        ports.promptNoModel(noModel);
    const work = async () => {
        try {
            let scan = await ports.scan(root, usable ? route : null, force);
            // A cache hit that skipped the overview for want of a route is stale once a route is usable: redo it once.
            if (usable && !force && skippedForNoRoute(scan))
                scan = await ports.scan(root, route, true);
            ports.setGrounding(scan.grounding);
            // The digest goes to the project's facts in the background, only when the `sync` capability is granted.
            if (key && ports.syncAllowed())
                void ports.afterScan(root, scan).catch((e) => ports.error("BuilderForce workspace digest failed:", e));
        }
        catch (e) {
            ports.error("BuilderForce codebase scan failed:", e);
        }
    };
    if (force) {
        await ports.withProgress("BuilderForce: rescanning codebase", work);
        ports.info("BuilderForce: codebase knowledge refreshed.");
    }
    else {
        await work();
    }
}
//# sourceMappingURL=workspaceScanRun.js.map
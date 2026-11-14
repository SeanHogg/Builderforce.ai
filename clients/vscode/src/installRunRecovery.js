/**
 * Activation wiring for interrupted-run recovery (G22).
 *
 * `extension.ts` calls `installRunRecovery(context)` at activation: every run the
 * previous extension host left `running`/`queued`/`awaiting_input` is journaled
 * `interrupted` (never falsely `completed`) and returned as `recovered`.
 *
 * The run host (`brainRunHostPorts.ts`, through `hostRunLifecycle.ts`) records the
 * whole lifecycle of each run it starts through the same handle:
 *
 *   - `recordStarted` when it starts a run it owns;
 *   - `recordCheckpoint` after each tool step — `safeToResume` only after a step that
 *     cannot repeat an external effect (a successful, non-mutating, local tool);
 *   - `recordFinished` from the host's TERMINAL run-status event (`completed`,
 *     `failed`, `cancelled`) — not because a start promise settled, which it does on
 *     failure too;
 *   - `recordHeld` instead of `completed` when the finalize gate holds the run
 *     (`runDelta/runHoldGate.ts`, PRD 41 §12.5): `awaiting_input` with its hold;
 *     `recordReleased` when a person releases it (`completed`, with a waiver).
 *
 * A run with a recorded terminal status is never rewritten to `interrupted` by the
 * next activation; a run the host died inside still is. A continuation is a new turn
 * through the composer (the webview row); no recorded step is ever replayed.
 */
import { listInterruptedRuns, recoverInterruptedRuns, recordRunAcknowledged, recordRunCheckpoint, recordRunFinished, recordRunHeld, recordRunReleased, recordRunStarted, safeToResume, } from "./runRecovery";
const DEVICE_KEY = "builderforce.localDeviceId";
const installed = new WeakMap();
function asId(value) {
    if (value == null || value === "")
        return undefined;
    return String(value);
}
async function readDeviceId(ctx) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const id = ctx.globalState.get(DEVICE_KEY);
        if (typeof id === "string" && id.length > 0)
            return id;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("local_device_id_unavailable");
}
async function resolvePorts(ctx, ports) {
    if (ports?.store && ports.deviceId) {
        return { store: ports.store, deps: { deviceId: ports.deviceId, now: ports.now } };
    }
    const { localBrainApplication } = await import("./localFirstStore");
    const host = ctx;
    // Mint (or reuse) the same device id the local store stamps on every other record.
    localBrainApplication(host);
    const deviceId = ports?.deviceId ?? (await readDeviceId(ctx));
    return {
        store: ports?.store ?? localBrainApplication(host).store,
        deps: { deviceId, now: ports?.now },
    };
}
function bindHandle(opening, recovered, onError) {
    const afterRecovery = async () => {
        const opened = await opening;
        await recovered;
        return opened;
    };
    return {
        recovered,
        async recordStarted(args) {
            // The documented host line is `void …recordStarted(…)`. A journal miss must not
            // reject that call, and must not fail a run the host has already decided to start.
            try {
                const { store, deps } = await afterRecovery();
                const chatId = asId(args.chatId);
                const ticketId = asId(args.ticketId);
                await recordRunStarted(store, deps, {
                    runId: args.runId,
                    ...(chatId ? { chatId } : {}),
                    ...(ticketId ? { ticketId } : {}),
                    ...(args.destination ? { destination: args.destination } : {}),
                    ...(args.state !== undefined ? { state: args.state } : {}),
                });
            }
            catch (error) {
                // The run still starts; the next activation recovers whatever did commit.
                onError(error);
            }
        },
        async recordCheckpoint(args) {
            const { store, deps } = await afterRecovery();
            await recordRunCheckpoint(store, deps, args);
        },
        async recordFinished(args) {
            const { store, deps } = await afterRecovery();
            await recordRunFinished(store, deps, args);
        },
        async recordHeld(args) {
            const { store, deps } = await afterRecovery();
            await recordRunHeld(store, deps, args);
        },
        async recordReleased(args) {
            const { store, deps } = await afterRecovery();
            return recordRunReleased(store, deps, args);
        },
        async interrupted() {
            const { store } = await afterRecovery();
            return listInterruptedRuns(store);
        },
        async recordAcknowledged(runId) {
            const { store, deps } = await afterRecovery();
            await recordRunAcknowledged(store, deps, { runId });
        },
        safeToResume,
    };
}
/**
 * Journal every run the previous host left in flight as `interrupted`, and return the
 * handle the run host uses to record the next start. Idempotent per `ctx`: a second
 * call does not recover again, so a start recorded after the first recover is not
 * immediately marked interrupted.
 *
 * The first call records later starts through `recordStarted`. The next call, on a
 * new context, recovers those runs. Only a checkpoint written `safeToResume` may be
 * resumed. `recoverInterruptedRuns` is invoked in this function, not in a helper.
 */
export function installRunRecovery(ctx, ports) {
    const cached = installed.get(ctx);
    if (cached)
        return cached;
    const onError = ports?.onError ?? ((error) => console.warn("run recovery:", error));
    const opening = resolvePorts(ctx, ports);
    const recovered = opening
        .then(({ store, deps }) => recoverInterruptedRuns(store, deps))
        .catch((error) => {
        // A journal that cannot be opened recovers nothing; say so instead of hiding it.
        onError(error);
        return [];
    });
    const handle = bindHandle(opening, recovered, onError);
    installed.set(ctx, handle);
    return handle;
}
//# sourceMappingURL=installRunRecovery.js.map
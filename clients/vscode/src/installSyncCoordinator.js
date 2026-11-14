/**
 * Host installer for the local-first sync coordinator (#5899).
 *
 * Constructed by the chat slice of sync (`chatSyncHost.ts`, PRD 36) on each pass,
 * and only while `synchronize` is granted. This module does not open IndexedDB,
 * touch the editor, or open a socket.
 *
 * `installSyncCoordinator` only constructs the coordinator, and only when
 * `synchronize` is granted. It does not drain. `drainQueuedCreates` is the
 * handoff: a queued `operation: "create"` journal event is passed to
 * `coordinator.synchronize` only when that grant is on and a foreign holder
 * does not hold the lease. Age never steals. A holder other than this device
 * stays busy until it releases, including past 30s.
 *
 * Imports are limited to symbols already exported from `@builderforce/local-first`
 * on origin/main: `createSyncCoordinator`, `SyncTransport`, the store, and policy.
 */
import { createSyncCoordinator, destinationKey, } from "@builderforce/local-first";
/** A non-empty holder other than this device is busy until that holder releases. */
function heldByAnotherDevice(host) {
    // Age is not consulted. A future clock does not take the lease.
    void host.now;
    void host.heldSince;
    const holder = host.holder;
    return typeof holder === "string" && holder.length > 0 && holder !== host.deviceId;
}
function isHandableCreate(event) {
    return event.operation === "create"
        && event.deadLetter === undefined
        && event.destination.kind === "bound";
}
function uniqueDestinations(events) {
    const seen = new Set();
    const destinations = [];
    for (const event of events) {
        const key = destinationKey(event.destination);
        if (seen.has(key))
            continue;
        seen.add(key);
        destinations.push(event.destination);
    }
    return destinations;
}
/**
 * Construct the coordinator when `synchronize` is granted. Does not push, pull,
 * or hand queued events to `synchronize` — that is `drainQueuedCreates`. A
 * foreign holder still constructs (so the host can see the refusal) but does
 * not start, and the coordinator is not returned.
 */
export function installSyncCoordinator(host) {
    if (host.synchronizeGranted !== true) {
        return { installed: false, reason: "synchronize_not_granted" };
    }
    const coordinator = createSyncCoordinator({
        deviceId: host.deviceId,
        store: host.store,
        transport: host.transport,
        policy: host.policy,
        lease: host.lease,
    });
    if (heldByAnotherDevice(host)) {
        return { installed: true, started: false, reason: "lease_busy" };
    }
    return { installed: true, started: true, coordinator };
}
/**
 * Hand each queued `operation: "create"` event to `synchronize` for its bound
 * destination. Refuses without calling `synchronize` when the grant is off, the
 * policy denies the capability, or another device holds the lease. Unbound and
 * dead-letter creates are left queued. Age does not override a foreign holder.
 */
export async function drainQueuedCreates(host) {
    const installed = installSyncCoordinator(host);
    if (!installed.installed) {
        return { drained: false, reason: "synchronize_not_granted", handed: [] };
    }
    if (!installed.started) {
        return { drained: false, reason: "lease_busy", handed: [] };
    }
    if (host.policy.allows("synchronize") !== true) {
        return { drained: false, reason: "synchronize_not_granted", handed: [] };
    }
    const pending = await host.store.read((tx) => tx.pending());
    const creates = pending.filter(isHandableCreate);
    for (const destination of uniqueDestinations(creates)) {
        await installed.coordinator.synchronize(destination);
    }
    return {
        drained: true,
        handed: creates.map((event) => ({ eventId: event.eventId, destination: event.destination })),
    };
}
//# sourceMappingURL=installSyncCoordinator.js.map
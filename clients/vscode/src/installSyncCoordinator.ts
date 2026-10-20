/**
 * Host installer for the local-first sync coordinator (#5899).
 *
 * Not referenced by `extension.ts`. Activation must not call this until a slice
 * that owns `extension.ts` wires it. This module does not open IndexedDB, touch
 * the editor, or open a socket.
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

import {
  createSyncCoordinator,
  destinationKey,
  type EntityDestination,
  type JournalEvent,
  type LocalFirstStore,
  type PlatformPolicy,
  type SyncLease,
  type SyncTransport,
} from "@builderforce/local-first";

/** The coordinator lease. A fenced lease's `signal` and `holds()` reach the coordinator. */
export type SyncCoordinatorLease = SyncLease;

export interface SyncCoordinatorHost {
  /** Host grant. Anything other than true refuses construction and the drain. */
  readonly synchronizeGranted?: boolean;
  readonly deviceId: string;
  readonly store: LocalFirstStore;
  readonly transport: SyncTransport;
  readonly policy: PlatformPolicy;
  readonly lease: SyncCoordinatorLease;
  /**
   * Current durability holder, when the host knows one. A non-empty holder
   * other than `deviceId` blocks start and the drain. Empty, missing, and
   * this device do not. `now` and `heldSince` are ignored: age never steals.
   */
  readonly holder?: string | null;
  readonly now?: number;
  readonly heldSince?: number;
}

export type InstallSyncCoordinatorResult =
  | { readonly installed: false; readonly reason: "synchronize_not_granted" }
  | { readonly installed: true; readonly started: false; readonly reason: "lease_busy" }
  | {
      readonly installed: true;
      readonly started: true;
      readonly coordinator: ReturnType<typeof createSyncCoordinator>;
    };

export interface QueuedCreateHandoff {
  readonly eventId: string;
  readonly destination: EntityDestination;
}

export type DrainQueuedCreatesResult =
  | {
      readonly drained: false;
      readonly reason: "synchronize_not_granted" | "lease_busy";
      readonly handed: readonly [];
    }
  | { readonly drained: true; readonly handed: readonly QueuedCreateHandoff[] };

/** A non-empty holder other than this device is busy until that holder releases. */
function heldByAnotherDevice(host: SyncCoordinatorHost): boolean {
  // Age is not consulted. A future clock does not take the lease.
  void host.now;
  void host.heldSince;
  const holder = host.holder;
  return typeof holder === "string" && holder.length > 0 && holder !== host.deviceId;
}

function isHandableCreate(event: JournalEvent): boolean {
  return event.operation === "create"
    && event.deadLetter === undefined
    && event.destination.kind === "bound";
}

function uniqueDestinations(events: readonly JournalEvent[]): EntityDestination[] {
  const seen = new Set<string>();
  const destinations: EntityDestination[] = [];
  for (const event of events) {
    const key = destinationKey(event.destination);
    if (seen.has(key)) continue;
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
export function installSyncCoordinator(host: SyncCoordinatorHost): InstallSyncCoordinatorResult {
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
export async function drainQueuedCreates(host: SyncCoordinatorHost): Promise<DrainQueuedCreatesResult> {
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

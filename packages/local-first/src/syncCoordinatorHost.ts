/**
 * Package-entry factory for the sync coordinator host (#5920, unblocks #5899).
 *
 * `SyncCoordinatorHost` is the shape `clients/vscode/src/installSyncCoordinator.ts`
 * consumes. It is defined here, on the package entry, so a caller constructs one
 * with a single call and never imports the type from the VS Code client. The
 * client's structurally identical interface stays assignable to it.
 *
 * `createSyncCoordinatorHost` returns a plain, live host object. It does not
 * acquire the lease, start the coordinator, or touch the network: starting and
 * draining stay with the installer, which reads `holder`. When the caller does
 * not name a holder, it is read from the lease state at construction
 * (`readSyncLeaseHolder`), so a restored or synced process sees a foreign
 * holder before it decides to start or drain.
 */

import type { PlatformPolicy } from './policy.js';
import type { LocalFirstStore } from './store.js';
import type { SyncLease, SyncTransport } from './sync.js';
import { readSyncLeaseHolder } from './syncLease.js';

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

export interface CreateSyncCoordinatorHostOptions {
  readonly deviceId: string;
  readonly store: LocalFirstStore;
  /** Typically `createHttpSyncTransport(...)`. */
  readonly transport: SyncTransport;
  readonly policy: PlatformPolicy;
  /** Typically `createDeviceStoreCoordinatorLease(...)`. */
  readonly lease: SyncCoordinatorLease;
  readonly synchronizeGranted?: boolean;
  /**
   * The known holder. Omit to read it from the sync lease slot named by
   * `leaseDeviceId` / `leaseJournal`; pass `null` to say nobody holds it.
   */
  readonly holder?: string | null;
  readonly leaseDeviceId?: string;
  readonly leaseJournal?: string;
  /** Epoch-ms clock used to read the holder. Default `Date.now`. */
  readonly now?: () => number;
}

function required<T>(value: T | undefined | null, code: string): T {
  if (value === undefined || value === null) throw new Error(code);
  return value;
}

/** Build a live `SyncCoordinatorHost`. Never acquires the lease or starts the host. */
export function createSyncCoordinatorHost(options: CreateSyncCoordinatorHostOptions): SyncCoordinatorHost {
  if (typeof options.deviceId !== 'string' || options.deviceId.length === 0) {
    throw new Error('sync_host_device_required');
  }
  const clock = options.now ?? Date.now;
  const holder = options.holder !== undefined
    ? options.holder
    : readSyncLeaseHolder({
      now: clock,
      ...(options.leaseDeviceId !== undefined ? { deviceId: options.leaseDeviceId } : {}),
      ...(options.leaseJournal !== undefined ? { journal: options.leaseJournal } : {}),
    });
  return {
    ...(options.synchronizeGranted !== undefined ? { synchronizeGranted: options.synchronizeGranted } : {}),
    deviceId: options.deviceId,
    store: required(options.store, 'sync_host_store_required'),
    transport: required(options.transport, 'sync_host_transport_required'),
    policy: required(options.policy, 'sync_host_policy_required'),
    lease: required(options.lease, 'sync_host_lease_required'),
    holder,
  };
}

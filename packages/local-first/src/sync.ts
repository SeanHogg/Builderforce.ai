import type { PlatformPolicy } from './policy.js';
import {
  destinationKey,
  type EntityDestination,
  type JournalEvent,
  type LocalRecord,
  type SyncConflict,
  type SyncReceipt,
} from './records.js';
import { partitionUnboundPending, type UnboundSyncRefusal } from './creationDestination.js';
import { destinationsForSync, readOfflineDestinations } from './destinationRebind.js';
import { isJournalEventId, type LocalFirstStore, type LocalFirstTransaction } from './store.js';
import type { CoordinatorLeaseFence } from './syncLease.js';

export const SYNC_PROTOCOL_VERSION = 1;

export interface SyncPushBatch {
  batchId: string;
  protocolVersion: number;
  deviceId: string;
  destination: EntityDestination;
  events: JournalEvent[];
}

export interface SyncPullResult {
  records: LocalRecord[];
  cursor?: string;
  resnapshotRequired?: boolean;
}

/** Per-request options. `signal` aborts the request when the sync lease is lost. */
export interface SyncTransportInit {
  readonly signal?: AbortSignal;
}

export interface SyncTransport {
  push(batch: SyncPushBatch, init?: SyncTransportInit): Promise<SyncReceipt[]>;
  pull(input: { destination: EntityDestination; cursor?: string; limit: number }, init?: SyncTransportInit): Promise<SyncPullResult>;
}

/**
 * A lease that may hand its work a fence (`createDeviceStoreCoordinatorLease`
 * does). With a fence, transport requests carry its `signal`, and nothing pulled
 * or acknowledged is committed once `holds()` is false. A lease without one is
 * trusted for the whole run.
 */
export interface SyncLease {
  run<R>(owner: string, work: (fence?: CoordinatorLeaseFence) => Promise<R>): Promise<R | undefined>;
}

/** Thrown, before any store write, when the run's lease fence no longer holds. */
export const SYNC_LEASE_LOST = 'sync_lease_lost';

/**
 * Refuse the commit a run that lost its lease was about to make. The throw ends
 * the run before the transaction opens, so nothing is written; a timed-out run's
 * rejection reaches the lease's late-error report, any other reaches the caller.
 */
function assertFenceHolds(fence: CoordinatorLeaseFence | undefined): void {
  if (fence && !fence.holds()) throw new Error(SYNC_LEASE_LOST);
}

function transportInit(fence: CoordinatorLeaseFence | undefined): SyncTransportInit | undefined {
  return fence ? { signal: fence.signal } : undefined;
}

export interface SyncCoordinatorOptions {
  store: LocalFirstStore;
  transport: SyncTransport;
  policy: PlatformPolicy;
  deviceId: string;
  lease: SyncLease;
  maxEvents?: number;
  maxBytes?: number;
  maxPullRecords?: number;
  newId?: () => string;
  now?: () => Date;
}

/**
 * A live parent lookup a caller used to pass into sync. Accepted only so the
 * call can prove it is never invoked. It does not select a destination.
 */
export interface SnapshottedSyncInput {
  readonly liveParent?: unknown;
  readonly liveLookup?: () => unknown;
}

export interface SyncSummary {
  pulled: number;
  pushed: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  dependencyPending: number;
  bytes: number;
  /**
   * Pending events refused because their record is unbound. They stay in the
   * journal, unsent and unacknowledged, and count for nothing else here.
   */
  unboundRefused: number;
}

const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

async function mergePulled(
  tx: LocalFirstTransaction,
  remote: LocalRecord,
  destination: EntityDestination,
  now: Date,
): Promise<boolean> {
  const local = await tx.get(remote.entityType, remote.id);
  const pending = await tx.pending(destination);
  const hasPending = pending.some((event) => event.clientEntityId === remote.id);
  if (local && hasPending) {
    const conflict: SyncConflict = {
      id: `${remote.entityType}:${remote.id}:${local.version}:${remote.version}`,
      clientEntityId: remote.id,
      entityType: remote.entityType,
      local,
      remote,
      reason: 'pending_local_mutation_overlaps_remote_version',
      createdAt: now.toISOString(),
    };
    await tx.putConflict(conflict);
    return true;
  }
  await tx.put({
    ...remote,
    destination,
    baseVersion: remote.version,
    provenance: { ...remote.provenance, deviceId: remote.provenance?.deviceId ?? 'remote', source: 'imported' },
  });
  return false;
}

/**
 * Put `dependsOn` on the wire: every entry becomes a store-minted event id. A
 * caller key (`project:<id>:v1`) is resolved against ALL pending events — so a
 * forward reference written in the same transaction, or a dependency queued in
 * another destination's partition, still orders the push (the server answers
 * `dependency_pending` until it lands). A key with no pending event was already
 * acknowledged, so nothing is left to wait for and it is dropped. The journal
 * itself is not rewritten.
 */
export function wireDependencies(events: readonly JournalEvent[], allPending: readonly JournalEvent[]): JournalEvent[] {
  const byKey = new Map<string, string>();
  for (const event of allPending) {
    if (event.idempotencyKey !== undefined) byKey.set(event.idempotencyKey, event.eventId);
  }
  return events.map((event) => {
    const dependsOn: string[] = [];
    for (const id of event.dependsOn) {
      const wire = isJournalEventId(id) ? id : byKey.get(id);
      if (wire !== undefined && wire !== event.eventId && !dependsOn.includes(wire)) dependsOn.push(wire);
    }
    return { ...event, dependsOn };
  });
}

function batchEvents(events: readonly JournalEvent[], maxEvents: number, maxBytes: number): { batch: JournalEvent[]; bytes: number } {
  const pending = new Set(events.map((event) => event.eventId));
  const selected: JournalEvent[] = [];
  const selectedIds = new Set<string>();
  let bytes = 0;
  for (const event of events) {
    if (selected.length >= maxEvents || event.deadLetter) continue;
    if (event.dependsOn.some((id) => pending.has(id) && !selectedIds.has(id))) continue;
    const size = jsonBytes(event);
    if (selected.length > 0 && bytes + size > maxBytes) break;
    if (size > maxBytes) {
      selected.push(event);
      bytes += size;
      break;
    }
    selected.push(event);
    selectedIds.add(event.eventId);
    bytes += size;
  }
  return { batch: selected, bytes };
}

export function createSyncCoordinator(options: SyncCoordinatorOptions) {
  const maxEvents = options.maxEvents ?? 100;
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const maxPullRecords = options.maxPullRecords ?? 500;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  const owner = `local-first:${options.deviceId}`;

  const pull = async (
    destination: EntityDestination,
    fence: CoordinatorLeaseFence | undefined,
  ): Promise<{ count: number; conflicts: number }> => {
    const init = transportInit(fence);
    const cursor = await options.store.read((tx) => tx.cursor(destination));
    let result = await options.transport.pull({ destination, ...(cursor ? { cursor } : {}), limit: maxPullRecords }, init);
    if (result.resnapshotRequired) {
      assertFenceHolds(fence);
      await options.store.transact(async (tx) => {
        await tx.setCursor(destination, undefined);
      });
      result = await options.transport.pull({ destination, limit: maxPullRecords }, init);
    }
    assertFenceHolds(fence);
    const conflicts = await options.store.transact(async (tx) => {
      let count = 0;
      for (const record of result.records) {
        // G18: a tombstone is a deletion, not a row to merge. Writing it back
        // with `mergePulled` would resurrect the entity the server deleted.
        // A non-blank `deletedAt` is the same signal `applyServerCursor` uses.
        // The row is removed, and its body is never stored.
        if (typeof record.deletedAt === 'string' && record.deletedAt.trim() !== '') {
          await tx.delete(record.entityType, record.id);
          continue;
        }
        if (await mergePulled(tx, record, destination, now())) count += 1;
      }
      await tx.setCursor(destination, result.cursor);
      return count;
    });
    return { count: result.records.length, conflicts };
  };

  const syncPartition = async (
    destination: EntityDestination,
    fence: CoordinatorLeaseFence | undefined,
  ): Promise<SyncSummary> => {
    const pulled = await pull(destination, fence);
    const pending = await options.store.read(async (tx) =>
      wireDependencies(await tx.pending(destination), await tx.pending()));
    // G10: an unbound event parked in the bound partition (a record
    // rebound without its events, or a destination smuggled onto an
    // unbound value) is refused here, not pushed and not dropped. The
    // coordinator's own destination argument is already bound, so this is
    // the per-record check the destination argument cannot express.
    const { syncable, refused } = partitionUnboundPending(pending);
    const { batch, bytes } = batchEvents(syncable, maxEvents, maxBytes);
    const summary: SyncSummary = {
      pulled: pulled.count,
      pushed: 0,
      duplicates: 0,
      conflicts: pulled.conflicts,
      rejected: 0,
      dependencyPending: 0,
      bytes,
      unboundRefused: refused.length,
    };
    if (batch.length === 0) return summary;
    assertFenceHolds(fence);
    const receipts = await options.transport.push({
      batchId: newId(),
      protocolVersion: SYNC_PROTOCOL_VERSION,
      deviceId: options.deviceId,
      destination,
      events: batch,
    }, transportInit(fence));
    const byEvent = new Map(receipts.map((receipt) => [receipt.eventId, receipt]));
    if (byEvent.size !== receipts.length) throw new Error('sync_duplicate_event_receipt');
    // The events stay pending when the lease was lost mid-push: the server's
    // receipts dedupe them on the next holder's push, so nothing is lost.
    assertFenceHolds(fence);
    await options.store.transact(async (tx) => {
      const acknowledged: string[] = [];
      for (const event of batch) {
        const receipt = byEvent.get(event.eventId);
        if (!receipt) continue;
        await tx.putReceipt(receipt);
        if (receipt.status === 'accepted') summary.pushed += 1;
        if (receipt.status === 'duplicate') summary.duplicates += 1;
        if (receipt.status === 'conflict') summary.conflicts += 1;
        if (receipt.status === 'rejected') summary.rejected += 1;
        if (receipt.status === 'dependency_pending') summary.dependencyPending += 1;
        if (receipt.serverId && receipt.serverVersion !== undefined) {
          await tx.putMapping({
            destination,
            entityType: event.entityType,
            clientEntityId: event.clientEntityId,
            serverId: receipt.serverId,
            serverVersion: receipt.serverVersion,
          });
        }
        if (receipt.status === 'accepted' || receipt.status === 'duplicate') acknowledged.push(event.eventId);
      }
      await tx.acknowledge(acknowledged);
    });
    const caughtUp = await pull(destination, fence);
    summary.pulled += caughtUp.count;
    summary.conflicts += caughtUp.conflicts;
    return summary;
  };

  const addSummary = (into: SyncSummary, part: SyncSummary): void => {
    into.pulled += part.pulled;
    into.pushed += part.pushed;
    into.duplicates += part.duplicates;
    into.conflicts += part.conflicts;
    into.rejected += part.rejected;
    into.dependencyPending += part.dependencyPending;
    into.bytes += part.bytes;
    into.unboundRefused += part.unboundRefused;
  };

  return {
    async synchronize(destination: EntityDestination): Promise<SyncSummary | undefined> {
      options.policy.assert('synchronize');
      if (destination.kind === 'unbound') throw new Error('sync_destination_required');
      return options.lease.run(owner, async (fence) => {
        options.policy.assert('synchronize');
        return syncPartition(destination, fence);
      });
    },

    /**
     * Sync written records to the destination snapshotted on each of them.
     * `liveParent` and `liveLookup` are the lookups this replaces
     * (`taskProjectId()`, the selected project, the parent after it moved).
     * They are not called. A record written against parent A is pushed to A
     * after that parent moves to B. Unbound events are refused, not pushed.
     * This does not rebind.
     */
    async synchronizeSnapshotted(input?: SnapshottedSyncInput): Promise<SyncSummary | undefined> {
      options.policy.assert('synchronize');
      return options.lease.run(owner, async (fence) => {
        options.policy.assert('synchronize');
        const liveParent = input?.liveLookup ?? input?.liveParent;
        void input?.liveLookup;
        void input?.liveParent;
        const { events, records } = await options.store.read(async (tx) => ({
          events: await tx.pending(),
          records: await tx.list(),
        }));
        const planned = destinationsForSync(events, records, liveParent);
        const summary: SyncSummary = {
          pulled: 0,
          pushed: 0,
          duplicates: 0,
          conflicts: 0,
          rejected: 0,
          dependencyPending: 0,
          bytes: 0,
          unboundRefused: planned.unboundRefused,
        };
        for (const destination of planned.bound) {
          addSummary(summary, await syncPartition(destination, fence));
        }
        return summary;
      });
    },

    /**
     * Offline read. Each record's destination key is the snapshot stored on
     * it. `liveParent` is not called and not read, so a parent move does not
     * move the record and does not rebind it.
     */
    async readOffline(liveParent?: unknown) {
      const records = await options.store.read((tx) => tx.list());
      return readOfflineDestinations(records, liveParent);
    },

    /**
     * G10: sync an unbound record, by asking the coordinator to push whatever is
     * parked in the unbound partition. There is no destination to name, so the
     * coordinator cannot `synchronize` it — that call throws
     * `sync_destination_required` for an unbound argument. This is the path a
     * caller uses instead, and it refuses every event rather than dropping it.
     *
     * Nothing is sent. The events stay pending, so the same call after a
     * destination is chosen returns an empty refusal.
     */
    async refuseUnbound(): Promise<UnboundSyncRefusal[]> {
      const pending = await options.store.read((tx) => tx.pending({ kind: 'unbound' }));
      const { syncable, refused } = partitionUnboundPending(pending);
      if (syncable.length > 0) {
        throw new Error('unbound_partition_held_bound_event');
      }
      return refused;
    },
    destinationKey,
  };
}

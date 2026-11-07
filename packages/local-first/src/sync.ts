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
import { SCAN_STOP, selectPending, type LocalFirstStore, type LocalFirstTransaction } from './store.js';
import type { CoordinatorLeaseFence } from './syncLease.js';
import { blockedEventIds, dependencyIndex, loadMappedEntities, resolveDependency } from './dependencyGraph.js';
import { rebaseImportsOntoMapping, rebaseNewerWrites } from './journalRules.js';
import { isPermanentRefusal } from './permanentRefusals.js';

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
  let hasPending = false;
  await tx.scanPending((event) => {
    if (event.clientEntityId === remote.id) { hasPending = true; return SCAN_STOP; }
  }, destination);
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
  // A pulled server row MAY name its own server id alongside the client id
  // (`serverId` is not part of `LocalRecord`; the wire row carries it when the
  // server knows it). Record the mapping so a caller handed the numeric server
  // id (a prompt directive names the selected project by it) resolves it back to
  // the live client id via `mappingByServerId`. Idempotent — writing the same
  // row again is the same mapping.
  const serverId = 'serverId' in remote ? (remote as { serverId?: unknown }).serverId : undefined;
  if (typeof serverId === 'string' && serverId.trim() !== '') {
    await tx.putMapping({
      destination,
      entityType: remote.entityType,
      clientEntityId: remote.id,
      serverId,
      serverVersion: remote.version,
    });
  }
  return false;
}

/**
 * Put `dependsOn` on the wire as event ids, resolved NOW. A dependency is a logical write's
 * idempotency key (or, in an older stored event, a wire id); it names whichever LIVE pending event
 * currently carries that key, in ANY destination's partition, so a replaced write (a bound row's
 * import dropped and re-queued under a new id) is followed, not stranded. Nothing pending under it
 * means it was acknowledged: the dependency is dropped. Dead-lettered events are not live, and a
 * dependent of one is filtered out before this by `blockedEventIds`. The journal is not rewritten.
 */
export function wireDependencies(
  events: readonly JournalEvent[],
  allPending: readonly JournalEvent[],
  mapped: ReadonlySet<string> = new Set(),
): JournalEvent[] {
  const index = dependencyIndex(allPending, mapped);
  return events.map((event) => {
    const dependsOn: string[] = [];
    for (const dependency of event.dependsOn) {
      const resolved = resolveDependency(dependency, index, event);
      if (resolved.kind !== 'event') continue;
      const wire = resolved.event.eventId;
      if (wire !== event.eventId && !dependsOn.includes(wire)) dependsOn.push(wire);
    }
    return { ...event, dependsOn };
  });
}

/**
 * Pick the next batch. A HELD event (`holdAttempts` > 0: the server answered `dependency_pending`,
 * `conflict` or a non-permanent refusal) is persisted on the journal event, so this holds across
 * coordinators and restarts. Held events are ALWAYS ordered after fresh work, are skipped until
 * their `nextAttemptAt` backoff has passed, and their dependents (transitively) are skipped, since
 * the server would only hold them too. Dead-lettered events are never sent.
 */
function batchEvents(
  events: readonly JournalEvent[],
  maxEvents: number,
  maxBytes: number,
  at: number,
): { batch: JournalEvent[]; bytes: number } {
  const isHeld = (event: JournalEvent): boolean => (event.holdAttempts ?? 0) > 0;
  const held = new Set(events.filter(isHeld).map((event) => event.eventId));
  const pending = new Set(events.map((event) => event.eventId));
  const behindHeld = new Set<string>();
  for (const event of events) {
    if (event.dependsOn.some((id) => held.has(id) || behindHeld.has(id))) behindHeld.add(event.eventId);
  }
  const ordered = [
    ...events.filter((event) => !held.has(event.eventId)),
    ...events.filter((event) => held.has(event.eventId)),
  ];
  const selected: JournalEvent[] = [];
  const selectedIds = new Set<string>();
  let bytes = 0;
  for (const event of ordered) {
    if (selected.length >= maxEvents) break;
    if (event.deadLetter || behindHeld.has(event.eventId)) continue;
    if (event.nextAttemptAt !== undefined && Date.parse(event.nextAttemptAt) > at) continue;
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

/** Backoff after a hold: 30s · 2^(n-1), capped at an hour. Give up only on AGE (7 days), never on a count. */
const HOLD_BACKOFF_BASE_MS = 30_000;
const HOLD_BACKOFF_CAP_MS = 60 * 60 * 1000;
const HOLD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
    const pending = await options.store.read(async (tx) => {
      // The destination's events are what is sent, so they are cloned; the key lookup
      // that orders them only reads every pending event, so it borrows them uncloned.
      const every: JournalEvent[] = [];
      await tx.scanPending((event) => { every.push(event as JournalEvent); });
      every.sort((a, b) => a.localSequence - b.localSequence);
      // A dependent of a dead-lettered write is BLOCKED (not sent, not counted) until a new live
      // event appears under that key; it needs no state change of its own to become sendable.
      const mapped = await loadMappedEntities(tx, every);
      const blocked = blockedEventIds(every, mapped);
      const sendable = (await selectPending(tx, undefined, destination)).filter((event) => !blocked.has(event.eventId));
      return wireDependencies(sendable, every, mapped);
    });
    // G10: an unbound event parked in the bound partition (a record
    // rebound without its events, or a destination smuggled onto an
    // unbound value) is refused here, not pushed and not dropped. The
    // coordinator's own destination argument is already bound, so this is
    // the per-record check the destination argument cannot express.
    const { syncable, refused } = partitionUnboundPending(pending);
    const { batch, bytes } = batchEvents(syncable, maxEvents, maxBytes, now().getTime());
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
          // The user kept editing while this was in flight. A NEWER pending import of the row would
          // collide with the mapping just written, so it becomes an update on that version; a
          // newer update / delete based on the version just advanced is rebased onto the new one.
          if (event.operation === 'import' || event.operation === 'create') {
            // An import the server already holds (conflict) is itself rebased: it becomes the update.
            const alreadyImported = receipt.status === 'conflict' && receipt.detail === 'entity_already_imported';
            await rebaseImportsOntoMapping(
              tx, event.entityType, event.clientEntityId,
              alreadyImported ? event.localSequence - 1 : event.localSequence, receipt.serverVersion,
            );
          } else if (event.operation === 'update' && event.baseVersion !== undefined
            && receipt.status === 'accepted') {
            await rebaseNewerWrites(tx, event.entityType, event.clientEntityId, event.localSequence, event.baseVersion, receipt.serverVersion);
          }
        }
        if (receipt.status === 'accepted' || receipt.status === 'duplicate') acknowledged.push(event.eventId);
        const permanent = receipt.status === 'rejected' && isPermanentRefusal(receipt.detail);
        // A refusal no resend can fix is dead-lettered (not re-sent, not counted). Dependents are
        // NOT dead-lettered: they are blocked while no live event holds that key.
        if (permanent) await tx.deadLetter(event.eventId, receipt.detail ?? 'rejected', now().toISOString());
        // Anything else the server did not take (including an unknown refusal) is a HOLD.
        const holds = receipt.status === 'dependency_pending' || receipt.status === 'conflict'
          || (receipt.status === 'rejected' && !permanent);
        if (holds) {
          const at = now();
          const attempts = (event.holdAttempts ?? 0) + 1;
          const since = event.heldSince ?? at.toISOString();
          // A dependency_pending hold is the server waiting on a parent, not a defect of this event:
          // it backs off but never gives up. Everything else gives up once held for 7 days.
          if (receipt.status !== 'dependency_pending' && at.getTime() - Date.parse(since) >= HOLD_MAX_AGE_MS) {
            // Out of patience: surface it in sync status instead of retrying forever.
            await tx.deadLetter(event.eventId, `gave_up:${receipt.detail ?? receipt.status}`, at.toISOString());
          } else {
            const wait = Math.min(HOLD_BACKOFF_CAP_MS, HOLD_BACKOFF_BASE_MS * 2 ** (attempts - 1));
            await tx.hold(event.eventId, { holdAttempts: attempts, heldSince: since, nextAttemptAt: new Date(at.getTime() + wait).toISOString() });
          }
        }
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
        // Planning only reads each row's destination (and copies it), so the rows are
        // borrowed from the store, not cloned — every record and event of the store.
        const planned = await options.store.read(async (tx) => {
          const events: JournalEvent[] = [];
          const records: LocalRecord[] = [];
          await tx.scanPending((event) => { events.push(event as JournalEvent); });
          events.sort((a, b) => a.localSequence - b.localSequence);
          await tx.scan(undefined, (record) => { records.push(record as LocalRecord); });
          return destinationsForSync(events, records, liveParent);
        });
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

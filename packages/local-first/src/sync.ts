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
import { SCAN_STOP, type LocalFirstStore, type LocalFirstTransaction } from './store.js';
import { scanPendingOfRow } from './pendingQueries.js';
import type { CoordinatorLeaseFence } from './syncLease.js';
import { rebaseImportsOntoMapping, rebaseNewerWrites } from './journalRules.js';
import { nextHoldTransition, type HoldStatus } from './holdLimits.js';
import { jsonBytes } from './syncBatch.js';
import { materializeRound, pickRound } from './syncRound.js';
import { isRecordPayloadMarker } from './recordPayloadMarker.js';
import { addSyncSummary, countReceipt, emptySyncSummary, type SyncSummary } from './syncSummary.js';
import { parseSyncId, type SyncId } from './entityId.js';
import { isAlreadySatisfiedDelete, isPermanentRefusal } from './permanentRefusals.js';

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

/**
 * One `synchronize` round. `pull: false` pushes ONLY — no pull before or after. A drain sending
 * a long queue pulls once at the start and once at the end, not twice per batch: every request
 * counts against the tenant's rate limit, which the person's own tabs share.
 */
export interface SyncRoundOptions {
  readonly pull?: boolean;
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
 * The SyncId a wire row (a receipt, a pulled record) names: its `syncId`, else its `serverId` read
 * as one — EXCEPT an explicit `syncId: null`, which is the server saying the `serverId` text is not
 * a SyncId of this entity type (a Brain run step's id is not a message id). Never guessed past that.
 */
function wireSyncId(wire: { syncId?: unknown; serverId?: unknown }): SyncId | null {
  return wire.syncId === null ? null : parseSyncId(wire.syncId) ?? parseSyncId(wire.serverId);
}

/**
 * A live parent lookup a caller used to pass into sync. Accepted only so the
 * call can prove it is never invoked. It does not select a destination.
 */
export interface SnapshottedSyncInput {
  readonly liveParent?: unknown;
  readonly liveLookup?: () => unknown;
}

export type { SyncSummary } from './syncSummary.js';
export { wireDependencies } from './syncBatch.js';

async function mergePulled(
  tx: LocalFirstTransaction,
  remote: LocalRecord,
  destination: EntityDestination,
  now: Date,
): Promise<boolean> {
  const local = await tx.get(remote.entityType, remote.id);
  let hasPending = false;
  // The row's own events (per-row index): a pull of 500 rows must not walk the journal 500 times.
  await scanPendingOfRow(tx, remote.id, () => { hasPending = true; return SCAN_STOP; }, destination);
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
  // The wire row's server keys belong to the MAPPING only, never to the stored record.
  const { syncId: _wireSyncId, serverId: _wireServerId, ...record } = remote as LocalRecord & { syncId?: unknown; serverId?: unknown };
  await tx.put({
    ...record,
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
  const wire = remote as { syncId?: unknown; serverId?: unknown };
  const syncId = wireSyncId(wire);
  const serverId = typeof wire.serverId === 'string' && wire.serverId.trim() !== '' ? wire.serverId : undefined;
  if (syncId !== null || serverId !== undefined) {
    await tx.putMapping({
      destination,
      entityType: remote.entityType,
      clientEntityId: remote.id,
      syncId,
      ...(serverId !== undefined ? { serverId } : {}),
      serverVersion: remote.version,
    });
  }
  return false;
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
      await tx.setCursor(destination, result.cursor, now().toISOString());
      return count;
    });
    return { count: result.records.length, conflicts };
  };

  const syncPartition = async (
    destination: EntityDestination,
    fence: CoordinatorLeaseFence | undefined,
    round: SyncRoundOptions = {},
  ): Promise<SyncSummary> => {
    const pulled = round.pull === false ? { count: 0, conflicts: 0 } : await pull(destination, fence);
    // PICK (a read that costs the batch, `syncRound.ts`), then MATERIALIZE the picked
    // record-payload markers in one commit BEFORE the push: a resend after a lost response
    // must carry the bytes the server already hashed.
    const picked = await options.store.read((tx) => pickRound(tx, destination, { maxEvents, maxBytes, at: now().getTime() }));
    const summary: SyncSummary = { ...emptySyncSummary(picked.refused.length), pulled: pulled.count, conflicts: pulled.conflicts, bytes: 0 };
    if (picked.batch.length === 0) return summary;
    assertFenceHolds(fence);
    const { batch, bytes } = picked.batch.some(isRecordPayloadMarker)
      ? await options.store.transact((tx) => materializeRound(tx, picked.batch, maxBytes))
      : { batch: picked.batch, bytes: picked.batch.reduce((total, event) => total + jsonBytes(event), 0) };
    summary.bytes = bytes;
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
        const answered = byEvent.get(event.eventId);
        if (!answered) continue;
        // A delete the server refused only because its target is already gone is SETTLED: it is
        // recorded as a duplicate (the outcome already held), so it neither holds nor dead-letters.
        const settled: SyncReceipt = answered.status === 'rejected' && isAlreadySatisfiedDelete(event.entityType, event.operation, answered.detail)
          ? { ...answered, status: 'duplicate' }
          : answered;
        // The receipt names its record, so a status read never credits it to another one.
        const receipt: SyncReceipt = { ...settled, entityType: event.entityType, clientEntityId: event.clientEntityId };
        await tx.putReceipt(receipt);
        countReceipt(summary, receipt.status);
        // A receipt with a server version means the server holds the row: the mapping is written
        // EVEN WITHOUT an integer id (a mirror / usage row is keyed by its UUID, or by nothing), or
        // the row would re-queue as an import forever. Its `syncId` is then null — never guessed.
        if (receipt.serverVersion !== undefined) {
          const syncId = wireSyncId(receipt);
          await tx.putMapping({
            destination,
            entityType: event.entityType,
            clientEntityId: event.clientEntityId,
            syncId,
            ...(receipt.serverId ? { serverId: receipt.serverId } : {}),
            serverVersion: receipt.serverVersion,
          });
          // The user kept editing while this was in flight. A NEWER pending import of the row would
          // collide with the mapping just written, so it becomes an update on that version; a
          // newer update / delete based on the version just advanced is rebased onto the new one.
          if (event.operation === 'import' || event.operation === 'create') {
            // An import the server already holds (conflict) is itself rebased: it becomes the update.
            const alreadyImported = receipt.status === 'conflict' && receipt.detail === 'entity_already_imported';
            await rebaseImportsOntoMapping(
              tx, event.entityType, event.clientEntityId, destination,
              alreadyImported ? event.localSequence - 1 : event.localSequence, receipt.serverVersion,
            );
          } else if (event.operation === 'update' && event.baseVersion !== undefined
            && receipt.status === 'accepted') {
            await rebaseNewerWrites(tx, event.entityType, event.clientEntityId, destination, event.localSequence, event.baseVersion, receipt.serverVersion);
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
        // The hold policy (fresh clock on a new kind, backoff, give-up age) is `holdLimits.ts`'s.
        if (holds) {
          const next = nextHoldTransition(event, receipt.status as HoldStatus, receipt.detail, now());
          if (next.kind === 'dead_letter') await tx.deadLetter(event.eventId, next.reason, next.at);
          else await tx.hold(event.eventId, next.hold);
        }
      }
      await tx.acknowledge(acknowledged);
    });
    if (round.pull === false) return summary;
    const caughtUp = await pull(destination, fence);
    summary.pulled += caughtUp.count;
    summary.conflicts += caughtUp.conflicts;
    return summary;
  };

  return {
    async synchronize(destination: EntityDestination, round?: SyncRoundOptions): Promise<SyncSummary | undefined> {
      options.policy.assert('synchronize');
      if (destination.kind === 'unbound') throw new Error('sync_destination_required');
      return options.lease.run(owner, async (fence) => {
        options.policy.assert('synchronize');
        return syncPartition(destination, fence, round);
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
        const summary = emptySyncSummary(planned.unboundRefused);
        for (const destination of planned.bound) {
          addSyncSummary(summary, await syncPartition(destination, fence));
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

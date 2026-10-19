/**
 * Sync status derived from the local store (G23).
 *
 * One record plus that record's pending journal events, receipts, and
 * conflicts maps to exactly one of local, syncing, synced, conflict, or
 * dead-letter. Nothing is cached, and platformRequestAccount is not read.
 *
 * Precedence when more than one rule matches:
 * 1. an open conflict
 * 2. deadLetter on the newest pending event
 * 3. a pending event with no receipt
 * 4. an accepted or duplicate receipt and no newer pending event
 * 5. no receipt and no pending event
 *
 * A rejected or dependency_pending receipt does not settle the record, so a
 * denied sync stays syncing (or dead-letter once the event is gone) and is
 * never shown as done. A conflict receipt is an open conflict until a
 * SyncConflict for this record is resolved.
 *
 * Local audit completion is a separate question. It never requires a receipt.
 *
 * Device status is a separate read: `deriveSyncStatus(store)` and
 * `assertStatusFresh(previous, store)` below. That read takes the store only.
 * A cached previous status is never an input and is never retained.
 */

import type { JournalEvent, LocalRecord, SyncConflict, SyncReceipt } from './records.js';

export const SYNC_STATUSES = ['local', 'syncing', 'synced', 'conflict', 'dead-letter'] as const;

export type SyncStatus = (typeof SYNC_STATUSES)[number];

export interface SyncStatusInput {
  readonly record: LocalRecord;
  /** Pending journal events. Events for other records are ignored. */
  readonly events?: readonly JournalEvent[];
  /**
   * Receipts for this record, including receipts whose events were already
   * acknowledged and dropped from the journal. A receipt whose event id
   * belongs to a different record in `events` is ignored.
   */
  readonly receipts?: readonly SyncReceipt[];
  readonly conflicts?: readonly SyncConflict[];
}

function sameRecord(entityType: LocalRecord['entityType'], id: string, record: LocalRecord): boolean {
  return entityType === record.entityType && id === record.id;
}

function compareEvents(left: JournalEvent, right: JournalEvent): number {
  if (left.localSequence !== right.localSequence) return left.localSequence - right.localSequence;
  if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? -1 : 1;
  if (left.eventId === right.eventId) return 0;
  return left.eventId < right.eventId ? -1 : 1;
}

function isNewer(candidate: JournalEvent, than: JournalEvent): boolean {
  return compareEvents(than, candidate) < 0;
}

function isSettling(receipt: SyncReceipt): boolean {
  return receipt.status === 'accepted' || receipt.status === 'duplicate';
}

function isOpenConflict(
  record: LocalRecord,
  conflicts: readonly SyncConflict[],
  receipts: readonly SyncReceipt[],
): boolean {
  const mine = conflicts.filter((conflict) => sameRecord(conflict.entityType, conflict.clientEntityId, record));
  if (mine.some((conflict) => !conflict.resolvedAt)) return true;
  const conflictReceipt = receipts.some((receipt) => receipt.status === 'conflict');
  if (!conflictReceipt) return false;
  // A conflict receipt stays open until a SyncConflict for this record is resolved.
  return !mine.some((conflict) => Boolean(conflict.resolvedAt));
}

function noNewerPending(receipt: SyncReceipt, pending: readonly JournalEvent[]): boolean {
  const settled = pending.find((event) => event.eventId === receipt.eventId);
  if (!settled) return pending.length === 0;
  return !pending.some((event) => isNewer(event, settled));
}

/**
 * Map a local record and its journal facts to one sync status.
 * Events and conflicts for other records are ignored.
 */
export function deriveRecordSyncStatus(input: SyncStatusInput): SyncStatus {
  const rawEvents = input.events ?? [];
  const foreignEventIds = new Set(
    rawEvents
      .filter((event) => !sameRecord(event.entityType, event.clientEntityId, input.record))
      .map((event) => event.eventId),
  );
  const receipts = (input.receipts ?? []).filter((receipt) => !foreignEventIds.has(receipt.eventId));
  const pending = rawEvents
    .filter((event) => sameRecord(event.entityType, event.clientEntityId, input.record))
    .slice()
    .sort(compareEvents);
  const newest = pending[pending.length - 1];

  if (isOpenConflict(input.record, input.conflicts ?? [], receipts)) return 'conflict';
  if (newest?.deadLetter) return 'dead-letter';
  if (pending.some((event) => !receipts.some((receipt) => receipt.eventId === event.eventId))) return 'syncing';
  if (receipts.some((receipt) => isSettling(receipt) && noNewerPending(receipt, pending))) return 'synced';
  if (receipts.length === 0 && pending.length === 0) return 'local';
  if (pending.length > 0) return 'syncing';
  if (receipts.some((receipt) => receipt.status === 'rejected')) return 'dead-letter';
  return 'syncing';
}

/**
 * Device sync status, computed from the store on every read (G23).
 * A cached flag is not a field of this input and is not stored here.
 */
export const STORE_SYNC_STATUSES = ['idle', 'pending', 'conflict', 'offline'] as const;

export type StoreSyncStatus = (typeof STORE_SYNC_STATUSES)[number];

export interface SyncStatusStoreEvent {
  readonly eventId?: string;
  readonly clientEntityId?: string;
  readonly entityType?: LocalRecord['entityType'];
  /** True when this event has not been sent. */
  readonly unsent?: boolean;
  /** True when this event is still outstanding work. */
  readonly pending?: boolean;
  /** True when this event is in conflict. */
  readonly conflict?: boolean;
  readonly inConflict?: boolean;
  /** True when this event has already been sent and is not outstanding. */
  readonly sent?: boolean;
  readonly state?: string;
  readonly status?: string;
  readonly deadLetter?: { reason: string; at: string };
}

/**
 * The only input to a device status read. `reachable === false` is not itself
 * offline: offline also requires at least one pending event.
 */
export interface SyncStatusStore {
  readonly reachable: boolean;
  readonly events?: readonly SyncStatusStoreEvent[];
  readonly receipts?: readonly SyncReceipt[];
  readonly conflicts?: readonly SyncConflict[];
}

const SETTLED_LABELS = new Set(['sent', 'settled', 'synced', 'accepted', 'duplicate', 'idle']);

function eventLabel(event: SyncStatusStoreEvent): string | undefined {
  return event.state ?? event.status;
}

function receiptFor(event: SyncStatusStoreEvent, store: SyncStatusStore): SyncReceipt | undefined {
  if (!event.eventId) return undefined;
  return store.receipts?.find((receipt) => receipt.eventId === event.eventId);
}

function eventInConflict(event: SyncStatusStoreEvent, store: SyncStatusStore): boolean {
  if (event.conflict === true || event.inConflict === true) return true;
  if (eventLabel(event) === 'conflict') return true;
  if (receiptFor(event, store)?.status === 'conflict') return true;
  if (!event.clientEntityId || !event.entityType) return false;
  return (store.conflicts ?? []).some(
    (conflict) =>
      conflict.clientEntityId === event.clientEntityId &&
      conflict.entityType === event.entityType &&
      !conflict.resolvedAt,
  );
}

function eventSettled(event: SyncStatusStoreEvent, store: SyncStatusStore): boolean {
  if (eventInConflict(event, store)) return false;
  if (event.sent === true) return true;
  const label = eventLabel(event);
  if (label !== undefined && SETTLED_LABELS.has(label)) return true;
  if (event.unsent === true || event.pending === true || event.sent === false) return false;
  const receipt = receiptFor(event, store);
  return receipt?.status === 'accepted' || receipt?.status === 'duplicate';
}

/** Outstanding work: unsent, in conflict, or present and not settled. */
function eventPending(event: SyncStatusStoreEvent, store: SyncStatusStore): boolean {
  if (eventInConflict(event, store)) return true;
  if (eventSettled(event, store)) return false;
  return true;
}

function eventUnsent(event: SyncStatusStoreEvent, store: SyncStatusStore): boolean {
  if (eventInConflict(event, store) || eventSettled(event, store)) return false;
  return eventPending(event, store);
}

/**
 * Device status from store contents only. No previous status is accepted.
 *
 * - no pending events → idle, including when `reachable` is false
 * - any event in conflict → conflict, including when unreachable
 * - unreachable and at least one pending event → offline
 * - any unsent event → pending
 */
export function deriveDeviceSyncStatus(store: SyncStatusStore): StoreSyncStatus {
  const events = store.events ?? [];
  const pending = events.filter((event) => eventPending(event, store));
  if (pending.length === 0) return 'idle';
  if (pending.some((event) => eventInConflict(event, store))) return 'conflict';
  if (store.reachable === false) return 'offline';
  if (pending.some((event) => eventUnsent(event, store))) return 'pending';
  return 'pending';
}

function isSyncStatusStore(input: SyncStatusStore | SyncStatusInput): input is SyncStatusStore {
  return typeof (input as SyncStatusStore).reachable === 'boolean' && !('record' in input);
}

/**
 * Record status when given a record, or device status when given a store.
 * The store overload takes only the store: a cached status is not a parameter.
 */
export function deriveSyncStatus(store: SyncStatusStore): StoreSyncStatus;
export function deriveSyncStatus(input: SyncStatusInput): SyncStatus;
export function deriveSyncStatus(input: SyncStatusStore | SyncStatusInput): StoreSyncStatus | SyncStatus {
  if (isSyncStatusStore(input)) return deriveDeviceSyncStatus(input);
  return deriveRecordSyncStatus(input);
}

/**
 * Returns the status derived from `store` now, even when it differs from
 * `previous`. `previous` is not consulted, so a cached flag cannot win.
 */
export function assertStatusFresh(previous: string, store: SyncStatusStore): StoreSyncStatus {
  void previous;
  return deriveDeviceSyncStatus(store);
}

/** True only when an audit run's own payload says it completed. Receipts are not an input. */
export function isLocalAuditComplete(record: LocalRecord): boolean {
  if (record.entityType !== 'audit-run') return false;
  const payload = record.payload;
  if (!payload || typeof payload !== 'object') return false;
  return (payload as { status?: unknown }).status === 'completed';
}

/** Local audit completion never waits on an account upload or a server receipt. */
export function localAuditCompletionRequiresReceipt(): false {
  return false;
}

/**
 * Local work is finished when a local audit has completed, with no receipt,
 * or when the server has accepted the record. A denied sync is not finished.
 */
export function localWorkComplete(record: LocalRecord, status: SyncStatus): boolean {
  if (isLocalAuditComplete(record)) return true;
  return status === 'synced';
}

/**
 * A denied, in-flight, conflicting, or dead-lettered sync is not shown as done.
 * A completed local audit is done while it is still local or syncing, because
 * completion must not await account upload. Conflict and dead-letter stay visible.
 */
export function syncShownAsDone(record: LocalRecord, status: SyncStatus): boolean {
  if (status === 'conflict' || status === 'dead-letter') return false;
  if (isLocalAuditComplete(record)) return true;
  return status === 'synced';
}

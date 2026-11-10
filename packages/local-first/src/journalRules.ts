/**
 * How a local chat row's write is JOURNALED for sync (PRD 36 §36.4).
 *
 * Unbound (the chat is only on this machine): every write appends its own event, as it
 * always has. Nothing sends them — the coordinator refuses an unbound partition.
 *
 * Bound (sync was enabled for the account): a row the server has not imported yet is
 * represented by ONE pending `import` carrying its latest payload — each later write
 * replaces it — because the server has no version to apply an update against. Once a
 * sync receipt has mapped the row (server version ≥ 1), writes are `update` / `delete`
 * events based on the version the server holds, which is what its conflict policy
 * checks. A delete of a row the server never saw sends nothing.
 *
 * DECIDED (2026-11-01): the unbound frame does NOT persist the full payload copy.
 * An unbound event is never sent — the coordinator refuses an unbound partition — so
 * keeping its payload only duplicates the record's copy: tens of thousands of dead
 * events on a long-lived machine. The unbound journal is now a marker per write:
 * ids, type, operation, a size, and a content hash of the real payload. When the row
 * is later bound, `queueImport` replaces the marker with ONE real `import` whose
 * payload comes from the record (`tx.get` in `bindChatHistoryForSync`), never from the
 * frame — so no sendable payload is ever read back out of the marker. A later append
 * for the same idempotency key dedupes against the live marker the same as before.
 * The sendable payload stays owned by the record / import path; the G03
 * record-and-sync-in-one-frame contract is untouched (a bound frame still carries
 * both the record and its event in one commit).
 *
 * A chat bound by sign-in alone (`chatIdentity.ts`) has a mapping at version
 * {@link BOUND_ONLY_VERSION}: the server chat exists, its history has not been imported.
 * Its import names that chat (`serverId`) so the server adopts it instead of minting a
 * second one.
 */

import type { LocalFirstTransaction } from './storeContract.js';
import { selectPendingOf } from './pendingQueries.js';
import { hashPayload } from './payloadHash.js';
import type { EntityDestination, JournalEvent, JournalOperation, LocalEntityType, LocalRecord, ServerMapping } from './records.js';
import { parseSyncId } from './entityId.js';
import { ensureRecordPayloadFence, fencedDependsOn, isRecordPayloadMarker, recordPayloadMarker } from './recordPayloadMarker.js';

/** The version a sign-in binding records: a server chat exists, nothing was imported. */
export const BOUND_ONLY_VERSION = 0;

/**
 * Entity types whose server-bound DELETE still carries the payload. A relation (a chat-ticket link)
 * is identified by its pair, and the server may hold it without a sync mapping (made through its
 * own API, only ingested here), so the event must name the pair for the server to find it.
 * Data, not a branch: a new relation type is a new entry.
 */
export const PAYLOAD_ON_DELETE: ReadonlySet<LocalEntityType> = new Set<LocalEntityType>(['chat-ticket-link']);

/** The idempotency key of a row's pending import. */
export const importKey = (type: string, id: string): string => `${type}:${id}:import`;

export interface JournalWriteOptions {
  /** The write's own idempotency key (unbound journal). */
  key: string;
  /** Unbound: the events this one waits on. */
  dependsOn?: string[];
  /** The chat a message / usage row belongs to — a bound import waits on the chat's. */
  chatClientId?: string;
}

/** Whether a row is this device's own: written here, or this device's write pulled back. */
export function isOwnRecord(row: LocalRecord, deviceId: string): boolean {
  return row.provenance?.source !== 'imported' || row.provenance.deviceId === deviceId;
}

/** Whether the server has imported this row (a sync receipt mapped it). */
export function isImported(mapping: Pick<ServerMapping, 'serverVersion'> | undefined): boolean {
  return mapping !== undefined && mapping.serverVersion > BOUND_ONLY_VERSION;
}


/**
 * The marker an unbound write appends instead of a payload copy: ids, type,
 * operation, size and a content hash — enough to identify and reconcile the write
 * after a later bind, never a sendable payload (see the module comment).
 */
function unboundMarker(record: LocalRecord, operation: JournalOperation): {
  operation: JournalOperation;
  payloadSize: number;
  payloadHash: string;
  payload: null;
} {
  return { operation, ...unboundMarkerFields(record.payload) };
}

/** The payload half of an unbound marker: a size and a content hash of `payload`, never the payload. */
export function unboundMarkerFields(payload: unknown): { payloadSize: number; payloadHash: string; payload: null } {
  const text = JSON.stringify(payload) ?? 'null';
  return { payloadSize: text.length, payloadHash: hashPayload(payload), payload: null };
}

/**
 * Drop a row's events that have not been sent: a bound row's newest write carries its
 * whole state, so an older pending one for the same row would only be applied against a
 * version the newer write supersedes (and then conflict with it).
 */
export async function dropPending(tx: LocalFirstTransaction, record: Pick<LocalRecord, 'entityType' | 'id'>): Promise<void> {
  // The row's own events through the per-row index: a bind calls this once per row, so a
  // walk of every pending event here made binding a long history O(rows × events).
  const stale = await selectPendingOf(tx, record.entityType, record.id);
  if (stale.length > 0) await tx.acknowledge(stale.map((event) => event.eventId));
}

/**
 * A receipt just mapped this row (server version ≥ 1) while the user kept editing: the edit
 * re-queued a NEWER `import` (the in-flight one was dropped as stale). The server now holds the
 * row, so that import would collide with its own mapping. Turn each newer pending import into
 * the `update` the bound path would have written, based on the version the server holds. The
 * idempotency key is kept, so events that depend on the import follow it.
 */
export async function rebaseImportsOntoMapping(
  tx: LocalFirstTransaction,
  entityType: LocalRecord['entityType'],
  clientEntityId: string,
  destination: EntityDestination,
  afterSequence: number,
  serverVersion: number,
): Promise<void> {
  const newer = await selectPendingOf(
    tx,
    entityType,
    clientEntityId,
    (event) => event.operation === 'import' && event.localSequence > afterSequence,
    destination,
  );
  for (const event of newer) {
    await tx.acknowledge([event.eventId]);
    await tx.append({
      ...(event.idempotencyKey !== undefined ? { idempotencyKey: event.idempotencyKey } : {}),
      clientEntityId,
      entityType,
      operation: 'update',
      schemaVersion: event.schemaVersion,
      occurredAt: event.occurredAt,
      baseVersion: serverVersion,
      dependsOn: event.dependsOn,
      destination: event.destination,
      ...samePayload(event),
    });
  }
}

/** A rebased write keeps its payload — or stays a record-payload marker, read when it is sent. */
function samePayload(event: JournalEvent): { payload: unknown } {
  return isRecordPayloadMarker(event) ? recordPayloadMarker() : { payload: event.payload };
}

/**
 * A receipt just advanced a row from `fromBase` to `toVersion` while the user kept editing: newer
 * pending updates / deletes of that row were based on `fromBase` and would now conflict with the
 * version the server holds. Rebase each onto `toVersion` (same operation, same key, same payload).
 */
export async function rebaseNewerWrites(
  tx: LocalFirstTransaction,
  entityType: LocalRecord['entityType'],
  clientEntityId: string,
  destination: EntityDestination,
  afterSequence: number,
  fromBase: number,
  toVersion: number,
): Promise<void> {
  const newer = await selectPendingOf(
    tx,
    entityType,
    clientEntityId,
    (event) => (event.operation === 'update' || event.operation === 'delete')
      && event.localSequence > afterSequence
      && event.baseVersion === fromBase,
    destination,
  );
  for (const event of newer) {
    await tx.acknowledge([event.eventId]);
    await tx.append({
      ...(event.idempotencyKey !== undefined ? { idempotencyKey: event.idempotencyKey } : {}),
      clientEntityId,
      entityType,
      operation: event.operation,
      schemaVersion: event.schemaVersion,
      occurredAt: event.occurredAt,
      baseVersion: toVersion,
      dependsOn: event.dependsOn,
      destination: event.destination,
      ...samePayload(event),
    });
  }
}

/**
 * The payload a row is imported with: a sign-in-bound chat names its server chat. Read when the
 * import is SENT (the queued import is a record-payload marker, `recordPayloadMarker.ts`), so it
 * is the row and the binding as they are then.
 */
export function importPayload(record: LocalRecord, mapping: ServerMapping | undefined): unknown {
  if (record.entityType !== 'chat' || mapping?.serverVersion !== BOUND_ONLY_VERSION) return record.payload;
  const serverId = parseSyncId(mapping.syncId);
  return serverId !== null ? { ...(record.payload as object), serverId } : record.payload;
}

/**
 * Replace a bound row's pending events with ONE import of its current state (nothing,
 * when the row is deleted). Used by every bound write the server has not imported, and
 * by the sync pass that binds a long-offline chat's history (and the work — projects and
 * tickets — written beside it, `workBinding.ts`). `waitsOn` names further imports this one
 * must follow (a ticket's project / parent ticket), as `importKey`s.
 */
export async function queueImport(
  tx: LocalFirstTransaction,
  record: LocalRecord,
  chatClientId?: string,
  waitsOn: readonly string[] = [],
): Promise<void> {
  await dropPending(tx, record);
  if (record.deletedAt) return;
  // The import is the row as it is when SENT: no copy of the payload waits in the journal. The
  // marker is fenced so an older build sharing the journal never sends it (`recordPayloadMarker.ts`).
  if (record.destination.kind === 'bound') await ensureRecordPayloadFence(tx, record.destination);
  await tx.append({
    idempotencyKey: importKey(record.entityType, record.id),
    clientEntityId: record.id,
    entityType: record.entityType,
    operation: 'import',
    schemaVersion: record.schemaVersion,
    occurredAt: record.occurredAt,
    dependsOn: fencedDependsOn([...(chatClientId && record.entityType !== 'chat' ? [importKey('chat', chatClientId)] : []), ...waitsOn]),
    destination: record.destination,
    ...recordPayloadMarker(),
  });
}

/** Journal one write of a local chat row (see the module comment for the rule). */
export async function journalWrite(
  tx: LocalFirstTransaction,
  record: LocalRecord,
  operation: Exclude<JournalOperation, 'import'>,
  options: JournalWriteOptions,
): Promise<void> {
  if (record.destination.kind === 'unbound') {
    await tx.append({
      idempotencyKey: options.key,
      clientEntityId: record.id,
      entityType: record.entityType,
      schemaVersion: record.schemaVersion,
      occurredAt: record.occurredAt,
      ...(record.baseVersion !== undefined ? { baseVersion: record.baseVersion } : {}),
      dependsOn: options.dependsOn ?? [],
      destination: record.destination,
      // The marker carries size + a content hash of the real payload, never the
      // payload itself; the record is the only copy while unbound (module comment).
      ...unboundMarker(record, operation),
    });
    return;
  }
  const mapping = await tx.mapping(record.entityType, record.id, record.destination);
  if (!isImported(mapping)) {
    await queueImport(tx, record, options.chatClientId);
    return;
  }
  await dropPending(tx, record);
  await tx.append({
    idempotencyKey: `${options.key}:server`,
    clientEntityId: record.id,
    entityType: record.entityType,
    operation,
    schemaVersion: record.schemaVersion,
    occurredAt: record.occurredAt,
    baseVersion: mapping!.serverVersion,
    dependsOn: [],
    destination: record.destination,
    payload: operation === 'delete' && !PAYLOAD_ON_DELETE.has(record.entityType) ? null : record.payload,
  });
}

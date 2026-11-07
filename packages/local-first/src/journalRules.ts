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

import { selectPending, type LocalFirstTransaction } from './store.js';
import type { JournalOperation, LocalRecord, ServerMapping } from './records.js';

/** The version a sign-in binding records: a server chat exists, nothing was imported. */
export const BOUND_ONLY_VERSION = 0;

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

/** Whether the server has imported this row (a sync receipt mapped it). */
export function isImported(mapping: ServerMapping | undefined): boolean {
  return mapping !== undefined && mapping.serverVersion > BOUND_ONLY_VERSION;
}

/**
 * FNV-1a over the JSON of the real payload — the same alphabet the store's
 * `hashPayload` mints into a frame's `payloadHash` — so the unbound marker can
 * keep a content hash without computing it in two alphabets.
 */
function hashPayload(payload: unknown): string {
  const text = JSON.stringify(payload) ?? 'null';
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
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
  const text = JSON.stringify(record.payload) ?? 'null';
  return {
    operation,
    payloadSize: text.length,
    payloadHash: hashPayload(record.payload),
    payload: null,
  };
}

/**
 * Drop a row's events that have not been sent: a bound row's newest write carries its
 * whole state, so an older pending one for the same row would only be applied against a
 * version the newer write supersedes (and then conflict with it).
 */
async function dropPending(tx: LocalFirstTransaction, record: LocalRecord): Promise<void> {
  const stale = await selectPending(tx, (event) => event.clientEntityId === record.id && event.entityType === record.entityType);
  if (stale.length > 0) await tx.acknowledge(stale.map((event) => event.eventId));
}

/** The payload a row is imported with: a sign-in-bound chat names its server chat. */
function importPayload(record: LocalRecord, mapping: ServerMapping | undefined): unknown {
  if (record.entityType !== 'chat' || mapping?.serverVersion !== BOUND_ONLY_VERSION) return record.payload;
  const serverId = Number(mapping.serverId);
  return Number.isSafeInteger(serverId) && serverId > 0 ? { ...(record.payload as object), serverId } : record.payload;
}

/**
 * Replace a bound row's pending events with ONE import of its current state (nothing,
 * when the row is deleted). Used by every bound write the server has not imported, and
 * by the sync pass that binds a long-offline chat's history (and the work — projects and
 * tickets — written beside it, `workSync.ts`). `waitsOn` names further imports this one
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
  const mapping = await tx.mapping(record.entityType, record.id, record.destination);
  await tx.append({
    idempotencyKey: importKey(record.entityType, record.id),
    clientEntityId: record.id,
    entityType: record.entityType,
    operation: 'import',
    schemaVersion: record.schemaVersion,
    occurredAt: record.occurredAt,
    dependsOn: [...(chatClientId && record.entityType !== 'chat' ? [importKey('chat', chatClientId)] : []), ...waitsOn],
    destination: record.destination,
    payload: importPayload(record, mapping),
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
    payload: operation === 'delete' ? null : record.payload,
  });
}

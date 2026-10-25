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
 * A chat bound by sign-in alone (`chatIdentity.ts`) has a mapping at version
 * {@link BOUND_ONLY_VERSION}: the server chat exists, its history has not been imported.
 * Its import names that chat (`serverId`) so the server adopts it instead of minting a
 * second one.
 */

import type { JournalOperation, LocalFirstTransaction, LocalRecord, ServerMapping } from '@builderforce/local-first';

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
 * Drop a row's events that have not been sent: a bound row's newest write carries its
 * whole state, so an older pending one for the same row would only be applied against a
 * version the newer write supersedes (and then conflict with it).
 */
async function dropPending(tx: LocalFirstTransaction, record: LocalRecord): Promise<void> {
  const stale = (await tx.pending()).filter((event) => event.clientEntityId === record.id && event.entityType === record.entityType);
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
 * by the sync pass that binds a long-offline chat's history.
 */
export async function queueImport(tx: LocalFirstTransaction, record: LocalRecord, chatClientId?: string): Promise<void> {
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
    dependsOn: chatClientId && record.entityType !== 'chat' ? [importKey('chat', chatClientId)] : [],
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
      operation,
      schemaVersion: record.schemaVersion,
      occurredAt: record.occurredAt,
      ...(record.baseVersion !== undefined ? { baseVersion: record.baseVersion } : {}),
      dependsOn: options.dependsOn ?? [],
      destination: record.destination,
      payload: record.payload,
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

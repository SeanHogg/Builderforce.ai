/**
 * Bounded sync import use cases (G17).
 *
 * Named importers, and nothing else. There is no `importEntity(type, body)`
 * writer: ticket, project, chat, message and usage go to their owning use case,
 * every other accepted history type goes to the mirror, and an unknown type is
 * rejected by the caller.
 * These functions write the domain row (or, for the mirror, no row) and return
 * the mapping fields a push transaction persists beside the receipt.
 */

import { CONFLICT_POLICY_REQUIRE_USER, resolveConflict } from '../../../domain/sync/conflictPolicy';
import {
  MAX_SUPPORTED_SCHEMA_VERSION,
  destinationKey,
  hashSyncPayload,
} from '../../../domain/sync/syncProtocol';
import type {
  BoundedImportOutcome,
  SyncEntityMappingRow,
  SyncEventInput,
  SyncImportContext,
  SyncStoreSet,
} from '../syncPorts';
import { MIRROR_ENTITY_TYPES } from './importMirrorRecord';

export { importMirrorRecord, MIRROR_ENTITY_TYPES } from './importMirrorRecord';
export { importSyncedProject } from './importSyncedProject';
export { importSyncedTicket } from './importSyncedTicket';
export { importSyncedChat } from './importSyncedChat';
export { importSyncedMessage } from './importSyncedMessage';
export { importSyncedUsage } from './importSyncedUsage';
export type { BoundedImportOutcome, SyncImportMapping } from '../syncPorts';

export type SyncImporterName =
  | 'importSyncedTicket'
  | 'importSyncedProject'
  | 'importSyncedChat'
  | 'importSyncedMessage'
  | 'importSyncedUsage'
  | 'importMirrorRecord';

/** Entity type → its owning importer. Data, not branches: a new owner is a new row. */
const OWNED_BY: Readonly<Record<string, SyncImporterName>> = {
  ticket: 'importSyncedTicket',
  project: 'importSyncedProject',
  // PRD 36.4: a VS Code chat, its transcript and its local usage land as real rows.
  chat: 'importSyncedChat',
  message: 'importSyncedMessage',
  usage: 'importSyncedUsage',
};

/**
 * Which named importer owns this entity type. `null` means the push rejects
 * the type — it must not fall through into a generic payload writer.
 */
export function syncImporterFor(entityType: string): SyncImporterName | null {
  const owner = OWNED_BY[entityType];
  if (owner) return owner;
  if ((MIRROR_ENTITY_TYPES as readonly string[]).includes(entityType)) return 'importMirrorRecord';
  return null;
}

export function rejected(detail: string): BoundedImportOutcome {
  return { status: 'rejected', detail };
}

/** A parent that has not landed yet — answered `dependency_pending`, nothing written. */
export function pending(detail: string): BoundedImportOutcome {
  return { status: 'pending', detail };
}

/** Client time is client-reported: a clock ahead of ours is clamped to now. */
export function clampedClientTime(raw: unknown, now: Date): Date {
  const at = typeof raw === 'string' ? new Date(raw) : null;
  if (!at || Number.isNaN(at.getTime())) return now;
  return at.getTime() > now.getTime() ? now : at;
}

/** The server chat a client chat uuid was imported as in this tenant, or null. */
export async function mappedChatId(
  stores: Pick<SyncStoreSet, 'findMapping'>,
  tenantId: number,
  chatClientId: unknown,
): Promise<number | null> {
  if (typeof chatClientId !== 'string' || chatClientId.trim() === '') return null;
  const mapping = await stores.findMapping(tenantId, 'chat', chatClientId);
  return mapping ? serverNumericId(mapping.serverId) : null;
}

export function conflict(row: SyncEntityMappingRow, detail: string): BoundedImportOutcome {
  return {
    status: 'conflict',
    detail,
    serverId: row.serverId,
    serverVersion: row.serverVersion,
    payloadHash: row.payloadHash,
    destinationKey: row.destinationKey,
  };
}

export function appliedNew(
  serverId: string,
  serverVersion: number,
  destinationKeyValue: string,
  payload: unknown,
): BoundedImportOutcome {
  return {
    status: 'applied',
    serverId,
    serverVersion,
    payloadHash: hashSyncPayload(payload),
    destinationKey: destinationKeyValue,
    payload,
  };
}

export function appliedExisting(row: SyncEntityMappingRow, payload: unknown): BoundedImportOutcome {
  return {
    status: 'applied',
    serverId: row.serverId,
    serverVersion: row.serverVersion,
    payloadHash: row.payloadHash,
    destinationKey: row.destinationKey,
    payload,
  };
}

/** Defense in depth. The route already validated the batch; a swapped context must still not write. */
export function preludeRejection(event: SyncEventInput, ctx: SyncImportContext): BoundedImportOutcome | null {
  if (event.clientEntityId.trim() === '') return rejected('client_entity_id_required');
  if (event.schemaVersion < 1 || event.schemaVersion > MAX_SUPPORTED_SCHEMA_VERSION) {
    return rejected('schema_version_unsupported');
  }
  if (destinationKey(event.destination) !== ctx.destinationKey) return rejected('destination_mismatch');
  return null;
}

export function sameCanonical(row: SyncEntityMappingRow, payload: unknown): boolean {
  return row.payloadHash === hashSyncPayload(payload);
}

/**
 * Update/delete gate, decided by the ONE conflict policy (`domain/sync/
 * conflictPolicy`, `require_user` — never last-write-wins).
 *
 * A missing base version is a rejection, not an overwrite. Then, in policy order:
 * a tombstone on either side wins — a pushed delete applies even over a stale
 * base, a repeat delete of a deleted entity is acknowledged without a second
 * write (`tombstonePayload` is its stored payload), and an update cannot
 * resurrect a deleted entity; a base equal to the current version applies; any
 * other base is a conflict carrying the current mapping.
 *
 * `null` means "write it".
 */
export function mutateGate(
  event: SyncEventInput,
  ctx: SyncImportContext,
  mapping: SyncEntityMappingRow | null,
  tombstonePayload: unknown = null,
): BoundedImportOutcome | null {
  if (!mapping) return rejected('entity_not_imported');
  if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
  if (event.baseVersion === undefined) return rejected('base_version_required');
  const verdict = resolveConflict(
    {
      version: event.baseVersion,
      updatedAt: event.occurredAt,
      deletedAt: event.operation === 'delete' ? event.occurredAt : null,
    },
    {
      version: mapping.serverVersion,
      updatedAt: ctx.now.toISOString(),
      deletedAt: mapping.deletedAt ? mapping.deletedAt.toISOString() : null,
    },
    CONFLICT_POLICY_REQUIRE_USER,
  );
  if (verdict.status === 'resolved') {
    if (verdict.reason === 'local_tombstone') return null;
    if (verdict.reason === 'both_tombstones') return appliedExisting(mapping, tombstonePayload);
    return rejected('entity_deleted');
  }
  if (verdict.status === 'duplicate') return null;
  return conflict(mapping, 'base_version_conflict');
}

export function serverNumericId(serverId: string): number | null {
  if (!/^[1-9]\d*$/.test(serverId)) return null;
  const id = Number(serverId);
  return Number.isSafeInteger(id) ? id : null;
}

export function insertedId(rows: unknown): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  if (!row || typeof row !== 'object' || !('id' in row)) return null;
  const id = (row as { id: unknown }).id;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}


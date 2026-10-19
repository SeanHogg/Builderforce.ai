/**
 * Bounded sync import use cases (G17).
 *
 * Three named importers, and nothing else. There is no `importEntity(type, body)`
 * writer: ticket and project go to their owning use case, every other accepted
 * history type goes to the mirror, and an unknown type is rejected by the caller.
 * These functions write the domain row (or, for the mirror, no row) and return
 * the mapping fields a push transaction persists beside the receipt.
 */

import {
  MAX_SUPPORTED_SCHEMA_VERSION,
  destinationKey,
  hashSyncPayload,
  type LocalEntityType,
} from '../../../domain/sync/syncProtocol';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext } from '../syncPorts';
import { MIRROR_ENTITY_TYPES } from './importMirrorRecord';
import { importMirrorRecord } from './importMirrorRecord';
import { importSyncedProject } from './importSyncedProject';
import { importSyncedTicket } from './importSyncedTicket';

export { importMirrorRecord, MIRROR_ENTITY_TYPES } from './importMirrorRecord';
export { importSyncedProject } from './importSyncedProject';
export { importSyncedTicket } from './importSyncedTicket';

/** Mapping fields the port already describes (`SyncEntityMappingRow`). */
export interface SyncImportMapping {
  serverId: string;
  serverVersion: number;
  payloadHash: string;
  destinationKey: string;
}

/**
 * Importer outcome. `conflict` is a first-class result even though
 * `SyncImportOutcome` cannot express it — the route must not collapse a stale
 * base version into a generic rejection or a blind overwrite.
 */
export type BoundedImportOutcome =
  | ({ status: 'applied'; payload: unknown } & SyncImportMapping)
  | ({ status: 'conflict'; detail: string } & SyncImportMapping)
  | { status: 'rejected'; detail: string };

export type SyncImporterName = 'importSyncedTicket' | 'importSyncedProject' | 'importMirrorRecord';

/**
 * Which named importer owns this entity type. `null` means the route rejects
 * the type — it must not fall through into a generic payload writer.
 */
export function syncImporterFor(entityType: string): SyncImporterName | null {
  if (entityType === 'ticket') return 'importSyncedTicket';
  if (entityType === 'project') return 'importSyncedProject';
  if ((MIRROR_ENTITY_TYPES as readonly string[]).includes(entityType)) return 'importMirrorRecord';
  return null;
}

export function rejected(detail: string): BoundedImportOutcome {
  return { status: 'rejected', detail };
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
 * Update/delete gate. A missing base version is a rejection, not an overwrite.
 * A stale one is a conflict carrying the current mapping.
 */
export function mutateGate(
  event: SyncEventInput,
  ctx: SyncImportContext,
  mapping: SyncEntityMappingRow | null,
): BoundedImportOutcome | null {
  if (!mapping) return rejected('entity_not_imported');
  if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
  if (event.baseVersion === undefined) return rejected('base_version_required');
  if (event.baseVersion !== mapping.serverVersion) return conflict(mapping, 'base_version_conflict');
  return null;
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

export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && (current as { code: unknown }).code === '23505') return true;
    current = 'cause' in current ? (current as { cause: unknown }).cause : undefined;
  }
  return error instanceof Error && /unique|duplicate key/i.test(error.message);
}

/** Re-exported so a caller can dispatch without a generic writer. */
export const SYNC_IMPORTERS = {
  importSyncedTicket,
  importSyncedProject,
  importMirrorRecord,
} as const;

export type { LocalEntityType };

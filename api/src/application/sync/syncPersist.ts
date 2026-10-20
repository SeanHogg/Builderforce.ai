/**
 * Application — what one applied sync event writes, and how stored rows are
 * served back as `LocalRecord`s (G16/G18/G25).
 *
 * An accepted event writes, inside the push's unit of work: the mapping bump,
 * the projection row, the change-log row, and the journal receipt. A conflict
 * writes only its receipt. The journal keeps the payload and hash the CLIENT
 * sent — that is what a replay is compared against — while the mapping and the
 * projection keep the importer's canonical payload.
 *
 * Client time is preserved as `occurredAt`; server time is `receivedAt`; the
 * evidence label is always client-reported.
 */

import { CLIENT_REPORTED_EVIDENCE } from '../../domain/sync/occurredAtGate';
import type { EntityDestination, LocalEntityType, LocalRecord, SyncReceipt } from '../../domain/sync/syncProtocol';
import { receipt, type ParsedEvent } from './syncEnvelope';
import type {
  StoredSyncEvent,
  SyncAuthContext,
  SyncEventRow,
  SyncImportMapping,
  SyncRecordRow,
  SyncStoreSet,
} from './syncPorts';

/** The identity of one apply: who, from which device, in which batch, to where, when. */
export interface ApplyScope {
  auth: SyncAuthContext;
  deviceId: string;
  batchId: string;
  destination: EntityDestination;
  now: Date;
}

function provenance(scope: ApplyScope): NonNullable<LocalRecord['provenance']> {
  return {
    actorId: scope.auth.userId,
    deviceId: scope.deviceId,
    source: 'imported',
    evidence: CLIENT_REPORTED_EVIDENCE,
  };
}

function changeRecord(event: ParsedEvent, scope: ApplyScope, serverVersion: number, payload: unknown): LocalRecord {
  const record: LocalRecord = {
    id: event.clientEntityId,
    entityType: event.entityType as LocalEntityType,
    schemaVersion: event.schemaVersion,
    version: serverVersion,
    destination: { ...scope.destination },
    occurredAt: event.occurredAt,
    updatedAt: scope.now.toISOString(),
    payload,
    provenance: provenance(scope),
  };
  if (event.operation === 'delete') record.deletedAt = scope.now.toISOString();
  return record;
}

function journalRow(
  event: ParsedEvent,
  scope: ApplyScope,
  outcome: { status: 'accepted' | 'conflict'; serverId: string; serverVersion: number; detail: string | null },
): SyncEventRow {
  return {
    tenantId: scope.auth.tenantId,
    deviceId: scope.deviceId,
    eventId: event.eventId,
    batchId: scope.batchId,
    clientEntityId: event.clientEntityId,
    entityType: event.entityType as LocalEntityType,
    operation: event.operation,
    schemaVersion: event.schemaVersion,
    localSequence: event.localSequence,
    occurredAt: new Date(event.occurredAt),
    receivedAt: scope.now,
    baseVersion: event.baseVersion ?? null,
    dependsOn: [...event.dependsOn],
    destination: { ...scope.destination } as Record<string, unknown>,
    payload: event.payload,
    payloadHash: event.payloadHash,
    status: outcome.status,
    serverId: outcome.serverId,
    serverVersion: outcome.serverVersion,
    detail: outcome.detail,
  };
}

/** Mapping, projection, change row, receipt — all through the same unit of work. */
export async function persistAccepted(
  tx: SyncStoreSet,
  event: ParsedEvent,
  scope: ApplyScope,
  outcome: SyncImportMapping & { payload: unknown },
): Promise<void> {
  const tenantId = scope.auth.tenantId;
  const entityType = event.entityType as LocalEntityType;
  const occurredAt = new Date(event.occurredAt);
  await tx.upsertMapping({
    tenantId,
    entityType,
    clientEntityId: event.clientEntityId,
    serverId: outcome.serverId,
    serverVersion: outcome.serverVersion,
    destinationKey: outcome.destinationKey,
    payloadHash: outcome.payloadHash,
    createdByDevice: scope.deviceId,
    now: scope.now,
  });
  await tx.upsertRecord({
    tenantId,
    entityType,
    clientEntityId: event.clientEntityId,
    serverId: outcome.serverId,
    schemaVersion: event.schemaVersion,
    version: outcome.serverVersion,
    destinationKey: outcome.destinationKey,
    occurredAt,
    updatedAt: scope.now,
    deletedAt: event.operation === 'delete' ? scope.now : null,
    payload: outcome.payload,
    payloadHash: outcome.payloadHash,
    provenance: { ...provenance(scope) },
    receivedAt: scope.now,
  });
  await tx.appendChange({
    tenantId,
    entityType,
    clientEntityId: event.clientEntityId,
    serverId: outcome.serverId,
    operation: event.operation,
    version: outcome.serverVersion,
    destinationKey: outcome.destinationKey,
    record: changeRecord(event, scope, outcome.serverVersion, outcome.payload),
    occurredAt,
    deviceId: scope.deviceId,
    eventId: event.eventId,
  });
  await tx.insertEvent(journalRow(event, scope, {
    status: 'accepted',
    serverId: outcome.serverId,
    serverVersion: outcome.serverVersion,
    detail: null,
  }));
}

/** A conflict stores its receipt only — the mapping, projection and log are untouched. */
export async function persistConflict(
  tx: SyncStoreSet,
  event: ParsedEvent,
  scope: ApplyScope,
  outcome: { serverId: string; serverVersion: number; detail: string },
): Promise<void> {
  await tx.insertEvent(journalRow(event, scope, {
    status: 'conflict',
    serverId: outcome.serverId,
    serverVersion: outcome.serverVersion,
    detail: outcome.detail,
  }));
}

/**
 * The answer to a replayed (tenant, device, eventId). A replay must carry the
 * payload of the first delivery: a different payload under a used event id is
 * `event_payload_mismatch`, never a silent duplicate of the old one.
 */
export function replayReceipt(eventId: string, replayPayloadHash: string, existing: StoredSyncEvent): SyncReceipt {
  if (existing.payloadHash !== replayPayloadHash) {
    return receipt(eventId, 'rejected', existing.receivedAt.toISOString(), { detail: 'event_payload_mismatch' });
  }
  const status = existing.status === 'accepted' ? 'duplicate' : existing.status;
  return receipt(eventId, status, existing.receivedAt.toISOString(), existing);
}

function copyPayload<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice() as T;
  return { ...(value as object) } as T;
}

/** A change-log record served as-is (a copy, so callers cannot mutate the store's row). */
export function copyRecord(record: LocalRecord): LocalRecord {
  return {
    ...record,
    destination: { ...record.destination },
    payload: copyPayload(record.payload),
    ...(record.provenance ? { provenance: { ...record.provenance } } : {}),
  };
}

/** A projection row served as a snapshot record. A tombstone keeps its `deletedAt`. */
export function rowToRecord(row: SyncRecordRow, destination: EntityDestination): LocalRecord {
  const record: LocalRecord = {
    id: row.clientEntityId,
    entityType: row.entityType,
    schemaVersion: row.schemaVersion,
    version: row.version,
    destination: { ...destination },
    occurredAt: row.occurredAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    payload: copyPayload(row.payload),
  };
  if (row.deletedAt) record.deletedAt = row.deletedAt.toISOString();
  if (row.provenance && typeof row.provenance === 'object') {
    record.provenance = { ...row.provenance } as LocalRecord['provenance'];
  }
  return record;
}

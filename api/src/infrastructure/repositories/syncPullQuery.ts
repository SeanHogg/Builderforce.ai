/**
 * G18 pull — read `sync_changes` and `sync_records` through the existing cursor
 * codec, then apply that page to a local record set.
 *
 * A cursor `decodeSyncCursor` rejects, or a delta cursor whose rows have been
 * retention-swept, is `{ resnapshotRequired: true }` and nothing else. The page
 * readers are not called, and the local set is not merged. A tombstone
 * (`sync_changes.operation = 'delete'`, a non-blank `deletedAt` on the change
 * body, or `sync_records.deleted_at`) is a delete: its payload is not copied
 * onto the instruction and is not written into the local set.
 *
 * This does not reimplement `encodeSyncCursor` / `decodeSyncCursor`, and it is
 * not the HTTP route.
 */
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { decodeSyncCursor, encodeSyncCursor, type SnapshotCursor } from '../../domain/sync/syncProtocol';
import type { Db } from '../database/connection';
import { syncChanges, syncRecords } from '../database/schema/sync';
import { scopedToTenant } from '../database/tenantScope';

/** Same page cap the pull route uses. A caller cannot ask for an unbounded read. */
export const SYNC_PULL_PAGE_LIMIT = 500;

const RESNAPSHOT = Object.freeze({ resnapshotRequired: true as const });

export interface SyncChangeRow {
  readonly seq: number;
  readonly entityType: string;
  readonly clientEntityId: string;
  readonly serverId: string;
  readonly operation: string;
  readonly version: number;
  readonly destinationKey: string;
  readonly record: unknown;
  readonly occurredAt: Date | string;
  readonly deviceId: string;
  readonly eventId: string;
}

export interface SyncRecordRow {
  readonly entityType: string;
  readonly clientEntityId: string;
  readonly serverId: string;
  readonly schemaVersion: number;
  readonly version: number;
  readonly destinationKey: string;
  readonly occurredAt: Date | string;
  readonly updatedAt: Date | string;
  readonly deletedAt: Date | string | null;
  readonly payload: unknown;
  readonly provenance: unknown;
}

export interface ChangesAfterInput {
  readonly tenantId: number;
  readonly destinationKey: string | null;
  readonly afterSeq: number;
  readonly limit: number;
}

export interface RecordsAfterInput {
  readonly tenantId: number;
  readonly destinationKey: string | null;
  readonly afterEntityType: string;
  readonly afterClientEntityId: string;
  readonly limit: number;
}

export interface RecordsForClientsInput {
  readonly tenantId: number;
  readonly destinationKey: string | null;
  readonly clientEntityIds: readonly string[];
  readonly limit: number;
}

/** The table reads a pull is allowed to make. Tests substitute this; production uses {@link syncPullTablesFromDb}. */
export interface SyncPullTables {
  minChangeSeq(tenantId: number, destinationKey: string | null): Promise<number | null>;
  changesAfter(input: ChangesAfterInput): Promise<readonly SyncChangeRow[]>;
  recordsAfter(input: RecordsAfterInput): Promise<readonly SyncRecordRow[]>;
  recordsForClients(input: RecordsForClientsInput): Promise<readonly SyncRecordRow[]>;
}

export type PulledInstruction =
  | {
      readonly op: 'delete';
      readonly clientEntityId: string;
      readonly entityType: string;
      readonly seq?: number;
      readonly deletedAt?: string;
    }
  | {
      readonly op: 'upsert';
      readonly clientEntityId: string;
      readonly entityType: string;
      readonly payload: unknown;
      readonly seq?: number;
      readonly version?: number;
    };

/**
 * A usable page, or a resnapshot with no rows. The resnapshot shape has no
 * `changes` / `records` / `cursor`, so a caller cannot merge a partial page
 * by ignoring the flag and reading a field that is not there.
 */
export type PullSyncTablesResult =
  | { readonly resnapshotRequired: true }
  | {
      readonly resnapshotRequired: false;
      readonly cursor: string;
      readonly changes: readonly PulledInstruction[];
      readonly records: readonly PulledInstruction[];
    };

export interface PullSyncTablesInput {
  readonly tenantId: number;
  readonly cursor: string | null | undefined;
  readonly destinationKey?: string | null;
  readonly limit?: number;
  /** Caller already knows the cursor is outside the retained window. */
  readonly expired?: boolean;
}

export interface LocalPullRecord {
  readonly clientEntityId: string;
  readonly entityType: string;
  readonly payload?: unknown;
}

export type LocalPullApply<T extends LocalPullRecord> =
  | { readonly resnapshotRequired: true; readonly applied: false; readonly records: readonly T[] }
  | { readonly resnapshotRequired: false; readonly applied: true; readonly records: readonly T[] };

function destinationPredicate(
  column: typeof syncChanges.destinationKey | typeof syncRecords.destinationKey,
  destinationKey: string | null,
) {
  return destinationKey == null ? undefined : eq(column, destinationKey);
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) return SYNC_PULL_PAGE_LIMIT;
  return Math.min(limit, SYNC_PULL_PAGE_LIMIT);
}

/** A delta cursor is expired when the next retained row is not the one after it, or the log was swept. */
export function deltaCursorExpired(seq: number, minSeq: number | null): boolean {
  if (minSeq == null || !Number.isFinite(minSeq)) return seq > 0;
  return minSeq > seq + 1;
}

function asSeq(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const seq = Number(value);
    return Number.isSafeInteger(seq) ? seq : null;
  }
  return null;
}

function nonBlankTimestamp(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value.trim() !== '') return value;
  return null;
}

function bodyDeletedAt(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) return null;
  return nonBlankTimestamp((record as { deletedAt?: unknown }).deletedAt);
}

function changePayload(record: unknown): unknown {
  if (typeof record !== 'object' || record === null) return record;
  if ('payload' in record) return (record as { payload?: unknown }).payload;
  return record;
}

function entityKey(row: { entityType: string; clientEntityId: string }): string {
  return `${row.entityType}\0${row.clientEntityId}`;
}

function deleteInstruction(
  row: { entityType: string; clientEntityId: string },
  deletedAt: string | null,
  seq?: number,
): PulledInstruction {
  return Object.freeze({
    op: 'delete',
    clientEntityId: row.clientEntityId,
    entityType: row.entityType,
    ...(seq !== undefined ? { seq } : {}),
    ...(deletedAt ? { deletedAt } : {}),
  });
}

function upsertInstruction(
  row: { entityType: string; clientEntityId: string; version?: number },
  payload: unknown,
  seq?: number,
): PulledInstruction {
  return Object.freeze({
    op: 'upsert',
    clientEntityId: row.clientEntityId,
    entityType: row.entityType,
    payload,
    ...(seq !== undefined ? { seq } : {}),
    ...(row.version !== undefined ? { version: row.version } : {}),
  });
}

function toChangeInstruction(row: SyncChangeRow, projectionDeletedAt: string | null): PulledInstruction {
  const fromBody = bodyDeletedAt(row.record);
  if (projectionDeletedAt != null || fromBody != null || row.operation === 'delete') {
    return deleteInstruction(row, projectionDeletedAt ?? fromBody, row.seq);
  }
  return upsertInstruction(row, changePayload(row.record), row.seq);
}

function toRecordInstruction(row: SyncRecordRow): PulledInstruction {
  const deletedAt = nonBlankTimestamp(row.deletedAt);
  if (deletedAt != null) return deleteInstruction(row, deletedAt);
  return upsertInstruction(row, row.payload);
}

function isAfterKeyset(
  row: { entityType: string; clientEntityId: string },
  cursor: SnapshotCursor,
): boolean {
  if (row.entityType > cursor.afterEntityType) return true;
  if (row.entityType < cursor.afterEntityType) return false;
  return row.clientEntityId > cursor.afterClientEntityId;
}

export function minChangeSeqQuery(db: Db, tenantId: number, destinationKey: string | null) {
  return db
    .select({ seq: sql<string | number | null>`min(${syncChanges.seq})` })
    .from(syncChanges)
    .where(scopedToTenant(syncChanges, tenantId, destinationPredicate(syncChanges.destinationKey, destinationKey)));
}

export function changesAfterCursorQuery(db: Db, input: ChangesAfterInput) {
  return db
    .select({
      seq: syncChanges.seq,
      entityType: syncChanges.entityType,
      clientEntityId: syncChanges.clientEntityId,
      serverId: syncChanges.serverId,
      operation: syncChanges.operation,
      version: syncChanges.version,
      destinationKey: syncChanges.destinationKey,
      record: syncChanges.record,
      occurredAt: syncChanges.occurredAt,
      deviceId: syncChanges.deviceId,
      eventId: syncChanges.eventId,
    })
    .from(syncChanges)
    .where(scopedToTenant(
      syncChanges,
      input.tenantId,
      destinationPredicate(syncChanges.destinationKey, input.destinationKey),
      gt(syncChanges.seq, input.afterSeq),
    ))
    .orderBy(asc(syncChanges.seq))
    .limit(input.limit);
}

export function recordsAfterCursorQuery(db: Db, input: RecordsAfterInput) {
  const afterKeyset = or(
    gt(syncRecords.entityType, input.afterEntityType),
    and(
      eq(syncRecords.entityType, input.afterEntityType),
      gt(syncRecords.clientEntityId, input.afterClientEntityId),
    ),
  );
  return db
    .select({
      entityType: syncRecords.entityType,
      clientEntityId: syncRecords.clientEntityId,
      serverId: syncRecords.serverId,
      schemaVersion: syncRecords.schemaVersion,
      version: syncRecords.version,
      destinationKey: syncRecords.destinationKey,
      occurredAt: syncRecords.occurredAt,
      updatedAt: syncRecords.updatedAt,
      deletedAt: syncRecords.deletedAt,
      payload: syncRecords.payload,
      provenance: syncRecords.provenance,
    })
    .from(syncRecords)
    .where(scopedToTenant(
      syncRecords,
      input.tenantId,
      destinationPredicate(syncRecords.destinationKey, input.destinationKey),
      afterKeyset,
    ))
    .orderBy(asc(syncRecords.entityType), asc(syncRecords.clientEntityId))
    .limit(input.limit);
}

export function recordsForClientsQuery(db: Db, input: RecordsForClientsInput) {
  return db
    .select({
      entityType: syncRecords.entityType,
      clientEntityId: syncRecords.clientEntityId,
      serverId: syncRecords.serverId,
      schemaVersion: syncRecords.schemaVersion,
      version: syncRecords.version,
      destinationKey: syncRecords.destinationKey,
      occurredAt: syncRecords.occurredAt,
      updatedAt: syncRecords.updatedAt,
      deletedAt: syncRecords.deletedAt,
      payload: syncRecords.payload,
      provenance: syncRecords.provenance,
    })
    .from(syncRecords)
    .where(scopedToTenant(
      syncRecords,
      input.tenantId,
      destinationPredicate(syncRecords.destinationKey, input.destinationKey),
      inArray(syncRecords.clientEntityId, [...input.clientEntityIds]),
    ))
    .orderBy(asc(syncRecords.entityType), asc(syncRecords.clientEntityId))
    .limit(input.limit);
}

function toChangeRow(row: {
  seq: unknown;
  entityType: string;
  clientEntityId: string;
  serverId: string;
  operation: string;
  version: number;
  destinationKey: string;
  record: unknown;
  occurredAt: Date | string;
  deviceId: string;
  eventId: string;
}): SyncChangeRow | null {
  const seq = asSeq(row.seq);
  if (seq == null) return null;
  return {
    seq,
    entityType: row.entityType,
    clientEntityId: row.clientEntityId,
    serverId: row.serverId,
    operation: row.operation,
    version: row.version,
    destinationKey: row.destinationKey,
    record: row.record,
    occurredAt: row.occurredAt,
    deviceId: row.deviceId,
    eventId: row.eventId,
  };
}

function toRecordRow(row: {
  entityType: string;
  clientEntityId: string;
  serverId: string;
  schemaVersion: number;
  version: number;
  destinationKey: string;
  occurredAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
  payload: unknown;
  provenance: unknown;
}): SyncRecordRow {
  return {
    entityType: row.entityType,
    clientEntityId: row.clientEntityId,
    serverId: row.serverId,
    schemaVersion: row.schemaVersion,
    version: row.version,
    destinationKey: row.destinationKey,
    occurredAt: row.occurredAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    payload: row.payload,
    provenance: row.provenance,
  };
}

/** Drizzle reads of `sync_changes` and `sync_records`. The only production implementation of {@link SyncPullTables}. */
export function syncPullTablesFromDb(db: Db): SyncPullTables {
  return {
    async minChangeSeq(tenantId, destinationKey) {
      const [row] = await minChangeSeqQuery(db, tenantId, destinationKey);
      if (row?.seq == null) return null;
      return asSeq(row.seq);
    },
    async changesAfter(input) {
      const rows = await changesAfterCursorQuery(db, input);
      return rows.flatMap((row) => {
        const mapped = toChangeRow(row);
        return mapped ? [mapped] : [];
      });
    },
    async recordsAfter(input) {
      const rows = await recordsAfterCursorQuery(db, input);
      return rows.map(toRecordRow);
    },
    async recordsForClients(input) {
      if (input.clientEntityIds.length === 0) return [];
      const rows = await recordsForClientsQuery(db, input);
      return rows.map(toRecordRow);
    },
  };
}

function page(cursor: string, changes: readonly PulledInstruction[], records: readonly PulledInstruction[]): PullSyncTablesResult {
  return Object.freeze({
    resnapshotRequired: false as const,
    cursor,
    changes: Object.freeze(changes),
    records: Object.freeze(records),
  });
}

/**
 * Pull one page. Rejected and expired cursors return {@link RESNAPSHOT} before
 * any page read, so there is no partial merge to apply.
 */
export async function pullSyncTables(
  source: SyncPullTables,
  input: PullSyncTablesInput,
): Promise<PullSyncTablesResult> {
  if (input.expired === true) return RESNAPSHOT;
  if (typeof input.cursor !== 'string' || input.cursor.trim() === '') return RESNAPSHOT;
  const cursor = decodeSyncCursor(input.cursor);
  if (cursor == null) return RESNAPSHOT;

  const limit = clampLimit(input.limit);
  const destinationKey = input.destinationKey ?? null;

  if (cursor.kind === 'delta') {
    const minSeq = await source.minChangeSeq(input.tenantId, destinationKey);
    if (deltaCursorExpired(cursor.seq, minSeq)) return RESNAPSHOT;
    const changes = await source.changesAfter({
      tenantId: input.tenantId,
      destinationKey,
      afterSeq: cursor.seq,
      limit,
    });
    const kept = changes
      .filter((row) => Number.isFinite(row.seq) && row.seq > cursor.seq)
      .slice()
      .sort((left, right) => left.seq - right.seq || left.clientEntityId.localeCompare(right.clientEntityId));
    const ids = [...new Set(kept.map((row) => row.clientEntityId))];
    const projections = ids.length === 0
      ? []
      : await source.recordsForClients({
          tenantId: input.tenantId,
          destinationKey,
          clientEntityIds: ids,
          limit,
        });
    const tombstoned = new Map<string, string>();
    for (const row of projections) {
      const deletedAt = nonBlankTimestamp(row.deletedAt);
      if (deletedAt != null) tombstoned.set(entityKey(row), deletedAt);
    }
    const instructions = kept.map((row) => toChangeInstruction(row, tombstoned.get(entityKey(row)) ?? null));
    const nextSeq = kept.length === 0 ? cursor.seq : kept[kept.length - 1]!.seq;
    return page(encodeSyncCursor({ v: 1, kind: 'delta', seq: nextSeq }), instructions, []);
  }

  const records = await source.recordsAfter({
    tenantId: input.tenantId,
    destinationKey,
    afterEntityType: cursor.afterEntityType,
    afterClientEntityId: cursor.afterClientEntityId,
    limit,
  });
  const kept = records.filter((row) => isAfterKeyset(row, cursor));
  const instructions = kept.map(toRecordInstruction);
  const last = kept[kept.length - 1];
  const next = last
    ? encodeSyncCursor({
        v: 1,
        kind: 'snapshot',
        afterEntityType: last.entityType,
        afterClientEntityId: last.clientEntityId,
      })
    : encodeSyncCursor(cursor);
  return page(next, [], instructions);
}

/** Pull through the Drizzle readers. Same contract as {@link pullSyncTables}. */
export function pullSyncTablesFromDb(db: Db, input: PullSyncTablesInput): Promise<PullSyncTablesResult> {
  return pullSyncTables(syncPullTablesFromDb(db), input);
}

/**
 * Apply a pull page to a local record set. A tombstone removes the local row
 * and does not keep its body. A resnapshot returns the same local array and
 * applies nothing — a bad or expired cursor cannot partially merge.
 */
export function applyServerPullLocally<T extends LocalPullRecord>(
  local: readonly T[],
  pulled: PullSyncTablesResult,
): LocalPullApply<T> {
  if (pulled.resnapshotRequired) {
    return Object.freeze({ resnapshotRequired: true, applied: false, records: local });
  }
  const byKey = new Map<string, T>();
  for (const row of local) byKey.set(entityKey(row), row);
  for (const row of [...pulled.records, ...pulled.changes]) {
    const key = entityKey(row);
    if (row.op === 'delete') {
      byKey.delete(key);
      continue;
    }
    const previous = byKey.get(key);
    const next = {
      ...(previous ?? {}),
      clientEntityId: row.clientEntityId,
      entityType: row.entityType,
      payload: row.payload,
    } as T;
    byKey.set(key, next);
  }
  return Object.freeze({
    resnapshotRequired: false,
    applied: true,
    records: Object.freeze([...byKey.values()]),
  });
}

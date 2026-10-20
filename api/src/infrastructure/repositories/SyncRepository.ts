/**
 * Infrastructure — THE Drizzle implementation of the sync persistence port
 * (`application/sync/syncPorts.ts`, G15–G18).
 *
 * - Committed reads (replay lookup, dependency check, mapping lookup for
 *   destination binding, pull pages) run on the request handle. Reads of other
 *   contexts (project/task ownership, membership) are the injected
 *   `SyncReferenceReader`, built from those contexts' own gates.
 * - `transact` opens ONE interactive transaction (`inTransaction`) per applied
 *   event and hands the unit of work both the sync stores AND the named
 *   importers bound to that same transaction, so the importer's domain row,
 *   the mapping, projection, change row and receipt commit or roll back together.
 *
 * Every statement is tenant-scoped. The pull queries are the ones the retired
 * `syncPullQuery.ts` carried, now behind the port; `maxChangeSeq` is a single
 * aggregate (no page walk), and `minChangeSeq` / `changesAfter` are served by
 * `idx_sync_changes_destination (tenant_id, destination_key, seq)`.
 */

import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type {
  StoredSyncEvent,
  SyncChangeRow,
  SyncEntityMappingRow,
  SyncNamedImporters,
  SyncRecordRow,
  SyncReferenceReader,
  SyncStores,
  SyncStoreSet,
} from '../../application/sync/syncPorts';
import type { LocalEntityType, LocalRecord, SyncReceiptStatus } from '../../domain/sync/syncProtocol';
import { inTransaction, type Db, type Tx } from '../database/connection';
import { syncChanges, syncEntityMappings, syncEvents, syncRecords } from '../database/schema/sync';
import { scopedToTenant } from '../database/tenantScope';

/** Binds the named importers to a transaction (`application/sync/importers/namedSyncImporters`). */
export type SyncImportersFor = (tx: Tx) => SyncNamedImporters;

const toSeq = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) ? n : null;
};

/** The sync stores bound to one transaction. Writes exist only here. */
function storeSetFor(tx: Tx): SyncStoreSet {
  return {
    findEvent: (tenantId, deviceId, eventId) => findEvent(tx, tenantId, deviceId, eventId),
    acceptedEventIds: (tenantId, eventIds) => acceptedEventIds(tx, tenantId, eventIds),
    findMapping: (tenantId, entityType, clientEntityId) => findMapping(tx, tenantId, entityType, clientEntityId),

    async insertEvent(row) {
      await tx.insert(syncEvents).values({
        tenantId: row.tenantId,
        deviceId: row.deviceId,
        eventId: row.eventId,
        batchId: row.batchId,
        clientEntityId: row.clientEntityId,
        entityType: row.entityType,
        operation: row.operation,
        schemaVersion: row.schemaVersion,
        localSequence: row.localSequence,
        occurredAt: row.occurredAt,
        receivedAt: row.receivedAt,
        baseVersion: row.baseVersion,
        dependsOn: row.dependsOn,
        destination: row.destination,
        payload: row.payload ?? null,
        payloadHash: row.payloadHash,
        status: row.status,
        serverId: row.serverId,
        serverVersion: row.serverVersion,
        detail: row.detail,
      });
    },

    async upsertMapping(row) {
      await tx.insert(syncEntityMappings).values({
        tenantId: row.tenantId,
        entityType: row.entityType,
        clientEntityId: row.clientEntityId,
        serverId: row.serverId,
        serverVersion: row.serverVersion,
        destinationKey: row.destinationKey,
        payloadHash: row.payloadHash,
        createdByDevice: row.createdByDevice,
        createdAt: row.now,
        updatedAt: row.now,
      }).onConflictDoUpdate({
        target: [syncEntityMappings.tenantId, syncEntityMappings.entityType, syncEntityMappings.clientEntityId],
        set: {
          serverId: row.serverId,
          serverVersion: row.serverVersion,
          destinationKey: row.destinationKey,
          payloadHash: row.payloadHash,
          updatedAt: row.now,
        },
      });
    },

    async upsertRecord(row) {
      const values = {
        serverId: row.serverId,
        schemaVersion: row.schemaVersion,
        version: row.version,
        destinationKey: row.destinationKey,
        occurredAt: row.occurredAt,
        receivedAt: row.receivedAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
        payload: row.payload ?? null,
        provenance: row.provenance,
        payloadHash: row.payloadHash,
      };
      await tx.insert(syncRecords).values({
        tenantId: row.tenantId,
        entityType: row.entityType,
        clientEntityId: row.clientEntityId,
        ...values,
      }).onConflictDoUpdate({
        target: [syncRecords.tenantId, syncRecords.entityType, syncRecords.clientEntityId],
        set: values,
      });
    },

    async appendChange(row) {
      await tx.insert(syncChanges).values({
        tenantId: row.tenantId,
        entityType: row.entityType,
        clientEntityId: row.clientEntityId,
        serverId: row.serverId,
        operation: row.operation,
        version: row.version,
        destinationKey: row.destinationKey,
        record: row.record as unknown as Record<string, unknown>,
        occurredAt: row.occurredAt,
        deviceId: row.deviceId,
        eventId: row.eventId,
      });
    },
  };
}

type Reader = Pick<Tx, 'select'>;

async function findEvent(db: Reader, tenantId: number, deviceId: string, eventId: string): Promise<StoredSyncEvent | null> {
  const [row] = await db
    .select({
      batchId: syncEvents.batchId,
      status: syncEvents.status,
      serverId: syncEvents.serverId,
      serverVersion: syncEvents.serverVersion,
      detail: syncEvents.detail,
      receivedAt: syncEvents.receivedAt,
      payloadHash: syncEvents.payloadHash,
    })
    .from(syncEvents)
    .where(scopedToTenant(syncEvents, tenantId, eq(syncEvents.deviceId, deviceId), eq(syncEvents.eventId, eventId)))
    .limit(1);
  if (!row) return null;
  return { ...row, status: row.status as SyncReceiptStatus };
}

async function acceptedEventIds(db: Reader, tenantId: number, eventIds: readonly string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const rows = await db
    .select({ eventId: syncEvents.eventId })
    .from(syncEvents)
    .where(scopedToTenant(
      syncEvents,
      tenantId,
      inArray(syncEvents.eventId, [...eventIds]),
      inArray(syncEvents.status, ['accepted', 'duplicate']),
    ));
  return new Set(rows.map((row) => row.eventId));
}

async function findMapping(
  db: Reader,
  tenantId: number,
  entityType: LocalEntityType,
  clientEntityId: string,
): Promise<SyncEntityMappingRow | null> {
  const [row] = await db
    .select({
      serverId: syncEntityMappings.serverId,
      serverVersion: syncEntityMappings.serverVersion,
      payloadHash: syncEntityMappings.payloadHash,
      destinationKey: syncEntityMappings.destinationKey,
      deletedAt: syncRecords.deletedAt,
    })
    .from(syncEntityMappings)
    .leftJoin(syncRecords, and(
      eq(syncRecords.tenantId, syncEntityMappings.tenantId),
      eq(syncRecords.entityType, syncEntityMappings.entityType),
      eq(syncRecords.clientEntityId, syncEntityMappings.clientEntityId),
    ))
    .where(scopedToTenant(
      syncEntityMappings,
      tenantId,
      eq(syncEntityMappings.entityType, entityType),
      eq(syncEntityMappings.clientEntityId, clientEntityId),
    ))
    .limit(1);
  return row ?? null;
}

const RECORD_COLUMNS = {
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
};

/**
 * Build the one sync persistence adapter for a request handle. The importers
 * and the cross-context reference reader are injected by the composition
 * (`application/sync/syncStoresFor`), so this adapter imports no use case.
 */
export function createSyncRepository(
  db: Db,
  importersFor: SyncImportersFor,
  references: SyncReferenceReader,
): SyncStores {
  return {
    references,
    findEvent: (tenantId, deviceId, eventId) => findEvent(db, tenantId, deviceId, eventId),
    acceptedEventIds: (tenantId, eventIds) => acceptedEventIds(db, tenantId, eventIds),
    findMapping: (tenantId, entityType, clientEntityId) => findMapping(db, tenantId, entityType, clientEntityId),

    transact: (work) => inTransaction(db, (tx) => work({ stores: storeSetFor(tx), importers: importersFor(tx) })),

    async maxChangeSeq(tenantId) {
      const [row] = await db
        .select({ seq: sql<string | number | null>`max(${syncChanges.seq})` })
        .from(syncChanges)
        .where(scopedToTenant(syncChanges, tenantId));
      return toSeq(row?.seq) ?? 0;
    },

    async minChangeSeq(tenantId, destinationKey) {
      const [row] = await db
        .select({ seq: sql<string | number | null>`min(${syncChanges.seq})` })
        .from(syncChanges)
        .where(scopedToTenant(syncChanges, tenantId, eq(syncChanges.destinationKey, destinationKey)));
      return toSeq(row?.seq);
    },

    async changesAfter(tenantId, destinationKey, seq, limit): Promise<SyncChangeRow[]> {
      const rows = await db
        .select({ seq: syncChanges.seq, record: syncChanges.record })
        .from(syncChanges)
        .where(scopedToTenant(
          syncChanges,
          tenantId,
          eq(syncChanges.destinationKey, destinationKey),
          gt(syncChanges.seq, seq),
        ))
        .orderBy(asc(syncChanges.seq))
        .limit(limit);
      return rows.map((row) => ({ seq: Number(row.seq), record: row.record as unknown as LocalRecord }));
    },

    async snapshotAfter(tenantId, destinationKey, after, limit): Promise<SyncRecordRow[]> {
      const afterKeyset = after
        ? or(
          gt(syncRecords.entityType, after.entityType),
          and(eq(syncRecords.entityType, after.entityType), gt(syncRecords.clientEntityId, after.clientEntityId)),
        )
        : undefined;
      const rows = await db
        .select(RECORD_COLUMNS)
        .from(syncRecords)
        .where(scopedToTenant(syncRecords, tenantId, eq(syncRecords.destinationKey, destinationKey), afterKeyset))
        .orderBy(asc(syncRecords.entityType), asc(syncRecords.clientEntityId))
        .limit(limit);
      return rows.map((row) => ({
        ...row,
        entityType: row.entityType as LocalEntityType,
        provenance: (row.provenance ?? {}) as Record<string, unknown>,
      }));
    },
  };
}

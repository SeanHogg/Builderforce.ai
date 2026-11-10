/**
 * Infrastructure — THE Drizzle implementation of the sync persistence port
 * (`application/sync/syncPorts.ts`, G15–G18).
 *
 * - Committed reads (replay lookup, dependency check, mapping lookup for
 *   destination binding, pull pages) run on the request handle. Reads of other
 *   contexts (project/task ownership, membership) are the injected
 *   `SyncReferenceReader`, built from those contexts' own gates.
 * - `transact` opens ONE interactive transaction (`inTransaction`) per push BATCH.
 *   Each event runs in a SAVEPOINT of it (`tx.transaction`), handed both the sync
 *   stores AND the named importers bound to that savepoint, so the importer's
 *   domain row, the mapping, projection, change row and receipt of ONE event
 *   commit or roll back together while the batch goes on.
 *
 * Every statement is tenant-scoped. The pull reads live in `SyncPullRepository`.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type {
  StoredSyncEvent,
  SyncEntityMappingRow,
  SyncNamedImporters,
  SyncReferenceReader,
  SyncStores,
  SyncStoreSet,
} from '../../application/sync/syncPorts';
import type { LocalEntityType, SyncReceiptStatus } from '../../domain/sync/syncProtocol';
import { inTransaction, type Db, type Tx } from '../database/connection';
import { syncChanges, syncEntityMappings, syncEvents, syncRecords } from '../database/schema/sync';
import { scopedToTenant } from '../database/tenantScope';
import { createSyncPullStore } from './SyncPullRepository';

/** Binds the named importers to a transaction (`application/sync/importers/namedSyncImporters`). */
export type SyncImportersFor = (tx: Tx) => SyncNamedImporters;

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
        // Dual write (1339, expand): the text id older devices read, and the integer key.
        serverId: row.serverId,
        syncId: row.syncId ?? null,
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
          syncId: row.syncId ?? null,
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
      entityType: syncEvents.entityType,
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
      syncId: syncEntityMappings.syncId,
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

/**
 * Build the one sync persistence adapter for a request handle. The importers
 * and the cross-context reference reader are injected by the composition
 * (`application/sync/syncStoresFor`), so this adapter imports no use case.
 * `referencesInTx` binds the reference reader to a push transaction, so a row an
 * earlier event of the batch wrote is visible to a later one; without it the
 * committed reader is used.
 */
export function createSyncRepository(
  db: Db,
  importersFor: SyncImportersFor,
  references: SyncReferenceReader,
  referencesInTx?: (tx: Tx) => SyncReferenceReader,
): SyncStores {
  return {
    ...createSyncPullStore(db),
    references,
    findEvent: (tenantId, deviceId, eventId) => findEvent(db, tenantId, deviceId, eventId),
    acceptedEventIds: (tenantId, eventIds) => acceptedEventIds(db, tenantId, eventIds),
    findMapping: (tenantId, entityType, clientEntityId) => findMapping(db, tenantId, entityType, clientEntityId),

    // ONE transaction per push batch; each event is a SAVEPOINT (`tx.transaction` on the
    // transaction handle), so a failing event rolls back its own writes and the batch goes on.
    transact: (work) => inTransaction(db, (tx) => work({
      stores: storeSetFor(tx),
      importers: importersFor(tx),
      references: referencesInTx ? referencesInTx(tx) : references,
      savepoint: (inner) => tx.transaction((sp) => inner({ stores: storeSetFor(sp), importers: importersFor(sp) })),
    })),
  };
}


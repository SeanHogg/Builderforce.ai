/**
 * Schema — Synchronization, the server half of the versioned batch sync protocol
 * (docs/design/vsix-offline-first-architecture-review.md, G15–G18, G25; migration
 * 1247).
 *
 * The sync context owns DELIVERY facts, not domain rules: which event was accepted,
 * which client UUID maps to which server id at which version, what a pulling device
 * has not seen yet. Applying an event is delegated to the owning context's import
 * use case (`application/sync/importers/importSyncedTicket`, `importSyncedProject`,
 * or the mirror-record importer for history-only entities) —
 * these tables never replace a domain aggregate, they make push/pull replayable.
 * The one reader/writer is `infrastructure/repositories/SyncRepository.ts`.
 *
 * Column-level rationale lives in migration 1247 (+ 1251's destination index).
 * The only cross-context reference is the tenant FK, which check-domain-boundary
 * exempts by rule.
 */

import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './identity';

/** Durable per-(tenant, device, event) receipt journal — the replay anchor. */
export const syncEvents = pgTable('sync_events', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  deviceId:      varchar('device_id', { length: 128 }).notNull(),
  eventId:       uuid('event_id').notNull(),
  batchId:       varchar('batch_id', { length: 128 }).notNull(),
  clientEntityId: uuid('client_entity_id').notNull(),
  entityType:    varchar('entity_type', { length: 40 }).notNull(),
  operation:     varchar('operation', { length: 16 }).notNull(),
  schemaVersion: integer('schema_version').notNull(),
  localSequence: bigint('local_sequence', { mode: 'number' }).notNull(),
  occurredAt:    timestamp('occurred_at').notNull(),
  receivedAt:    timestamp('received_at').notNull().defaultNow(),
  baseVersion:   integer('base_version'),
  dependsOn:     jsonb('depends_on').$type<string[]>().notNull().default([]),
  destination:   jsonb('destination').$type<Record<string, unknown>>().notNull(),
  payload:       jsonb('payload').notNull(),
  payloadHash:   varchar('payload_hash', { length: 128 }).notNull(),
  status:        varchar('status', { length: 24 }).notNull(),
  serverId:      varchar('server_id', { length: 128 }),
  serverVersion: integer('server_version'),
  detail:        text('detail'),
}, (t) => [
  uniqueIndex('uq_sync_events_event').on(t.tenantId, t.deviceId, t.eventId),
  index('idx_sync_events_entity').on(t.tenantId, t.entityType, t.clientEntityId),
]);

/** Client entity UUID → server id + current version (the optimistic-concurrency counter). */
export const syncEntityMappings = pgTable('sync_entity_mappings', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  entityType:    varchar('entity_type', { length: 40 }).notNull(),
  clientEntityId: uuid('client_entity_id').notNull(),
  serverId:      varchar('server_id', { length: 128 }).notNull(),
  serverVersion: integer('server_version').notNull(),
  destinationKey: text('destination_key').notNull(),
  payloadHash:   varchar('payload_hash', { length: 128 }).notNull(),
  createdByDevice: varchar('created_by_device', { length: 128 }).notNull(),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_sync_entity_mappings_client').on(t.tenantId, t.entityType, t.clientEntityId),
  index('idx_sync_entity_mappings_server').on(t.tenantId, t.entityType, t.serverId),
]);

/**
 * The sync projection pull serves: one row per synced entity with its current
 * payload, client-reported provenance (G25) and tombstone (`deleted_at`).
 */
export const syncRecords = pgTable('sync_records', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  entityType:    varchar('entity_type', { length: 40 }).notNull(),
  clientEntityId: uuid('client_entity_id').notNull(),
  serverId:      varchar('server_id', { length: 128 }).notNull(),
  schemaVersion: integer('schema_version').notNull(),
  version:       integer('version').notNull().default(1),
  destinationKey: text('destination_key').notNull(),
  occurredAt:    timestamp('occurred_at').notNull(),
  receivedAt:    timestamp('received_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
  deletedAt:     timestamp('deleted_at'),
  payload:       jsonb('payload').notNull(),
  provenance:    jsonb('provenance').$type<Record<string, unknown>>().notNull().default({}),
  payloadHash:   varchar('payload_hash', { length: 128 }).notNull(),
}, (t) => [
  uniqueIndex('uq_sync_records_client').on(t.tenantId, t.entityType, t.clientEntityId),
  index('idx_sync_records_snapshot').on(t.tenantId, t.destinationKey, t.entityType, t.clientEntityId),
]);

/** Append-only delta log; `seq` is the opaque pull cursor's payload. */
export const syncChanges = pgTable('sync_changes', {
  seq:           bigserial('seq', { mode: 'number' }).primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  entityType:    varchar('entity_type', { length: 40 }).notNull(),
  clientEntityId: uuid('client_entity_id').notNull(),
  serverId:      varchar('server_id', { length: 128 }).notNull(),
  operation:     varchar('operation', { length: 16 }).notNull(),
  version:       integer('version').notNull(),
  destinationKey: text('destination_key').notNull(),
  record:        jsonb('record').$type<Record<string, unknown>>().notNull(),
  occurredAt:    timestamp('occurred_at').notNull(),
  recordedAt:    timestamp('recorded_at').notNull().defaultNow(),
  deviceId:      varchar('device_id', { length: 128 }).notNull(),
  eventId:       uuid('event_id').notNull(),
}, (t) => [
  index('idx_sync_changes_cursor').on(t.tenantId, t.seq),
  // Migration 1251: per-destination delta pages and cursor-expiry MIN(seq).
  index('idx_sync_changes_destination').on(t.tenantId, t.destinationKey, t.seq),
]);

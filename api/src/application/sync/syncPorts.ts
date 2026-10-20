/**
 * Application — Synchronization ports.
 *
 * The narrow interfaces the batch sync use cases ({@link SyncService}) depend
 * on. Persistence implements them in `infrastructure/repositories/
 * SyncRepository.ts` (and the ticket/project stores beside it); the HTTP routes
 * never see them. Keeping them here — consumer-side — is what lets the focused
 * tests drive the whole push/pull protocol against in-memory fakes.
 */

import type {
  EntityDestination,
  JournalEvent,
  LocalEntityType,
  LocalRecord,
} from '../../domain/sync/syncProtocol';
import type { SyncReceiptStatus } from '../../domain/sync/syncProtocol';

/** The authenticated caller a sync request runs as. */
export interface SyncAuthContext {
  tenantId: number;
  userId: string;
  role: string;
}

/** One event of a push batch, exactly as the wire contract carries it. */
export type SyncEventInput = JournalEvent<unknown>;

/** The replayable outcome stored beside a processed event (mutation + receipt commit together). */
export interface StoredEventReceipt {
  status: SyncReceiptStatus;
  serverId: string | null;
  serverVersion: number | null;
  detail: string | null;
  receivedAt: Date;
}

/** What the event journal answers for a replayed (tenant, device, eventId). */
export interface StoredSyncEvent extends StoredEventReceipt {
  batchId: string;
}

/** The client↔server identity mapping plus its optimistic-concurrency counter. */
export interface SyncEntityMappingRow {
  serverId: string;
  serverVersion: number;
  payloadHash: string;
  destinationKey: string;
}

/** The projection row a snapshot pull serves (already LocalRecord-shaped minus assembly). */
export interface SyncRecordRow {
  entityType: LocalEntityType;
  clientEntityId: string;
  serverId: string;
  schemaVersion: number;
  version: number;
  destinationKey: string;
  occurredAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  payload: unknown;
  provenance: Record<string, unknown>;
}

/** One delta-log row; `record` is the immutable LocalRecord snapshot clients merge. */
export interface SyncChangeRow {
  seq: number;
  record: LocalRecord;
}

/**
 * The stores a sync transaction sees. ONE factory-bound set per unit of work,
 * so the mutation, the mapping bump, the projection, the change-log entry and
 * the receipt either all commit or all roll back (G16).
 */
export interface SyncStoreSet {
  /** The stored receipt for a replayed event, or null when the event is new. */
  findEvent(tenantId: number, deviceId: string, eventId: string): Promise<StoredSyncEvent | null>;
  /** Persist the event AND its receipt. Only terminal outcomes are stored —
   *  `dependency_pending` is parked client-side and must stay retryable. */
  insertEvent(row: {
    tenantId: number;
    deviceId: string;
    eventId: string;
    batchId: string;
    clientEntityId: string;
    entityType: LocalEntityType;
    operation: string;
    schemaVersion: number;
    localSequence: number;
    occurredAt: Date;
    receivedAt: Date;
    baseVersion: number | null;
    dependsOn: string[];
    destination: Record<string, unknown>;
    payload: unknown;
    payloadHash: string;
    status: SyncReceiptStatus;
    serverId: string | null;
    serverVersion: number | null;
    detail: string | null;
  }): Promise<void>;
  /** Of the given event ids, the ones already accepted (or known duplicates) in this tenant. */
  acceptedEventIds(tenantId: number, eventIds: readonly string[]): Promise<Set<string>>;
  findMapping(tenantId: number, entityType: LocalEntityType, clientEntityId: string): Promise<SyncEntityMappingRow | null>;
  upsertMapping(row: {
    tenantId: number;
    entityType: LocalEntityType;
    clientEntityId: string;
    serverId: string;
    serverVersion: number;
    destinationKey: string;
    payloadHash: string;
    createdByDevice: string;
    now: Date;
  }): Promise<void>;
  /** Insert or replace the projection row pull serves for this entity. */
  upsertRecord(row: SyncRecordRow & { tenantId: number; receivedAt: Date }): Promise<void>;
  /** Append the delta-log entry other devices will pull. */
  appendChange(row: {
    tenantId: number;
    entityType: LocalEntityType;
    clientEntityId: string;
    serverId: string;
    operation: string;
    version: number;
    destinationKey: string;
    record: LocalRecord;
    occurredAt: Date;
    deviceId: string;
    eventId: string;
  }): Promise<void>;
}

/** Read side of pull — deliberately NOT transactional (a snapshot read is enough for a cursor page). */
export interface SyncPullStore {
  /** The lowest retained change seq for the tenant; null when the log is empty (or swept). */
  minChangeSeq(tenantId: number): Promise<number | null>;
  /** Delta page: changes after `seq`, oldest first, at most `limit`. */
  changesAfter(tenantId: number, destinationKey: string | null, seq: number, limit: number): Promise<SyncChangeRow[]>;
  /** Snapshot page: live projection rows keyset-paginated by (entityType, clientEntityId). */
  snapshotAfter(
    tenantId: number,
    destinationKey: string | null,
    after: { entityType: string; clientEntityId: string } | null,
    limit: number,
  ): Promise<SyncRecordRow[]>;
}

/** The full persistence port: reads for pull, plus one atomic unit of work for push. */
export interface SyncStores extends SyncStoreSet, SyncPullStore {
  transact<R>(work: (stores: SyncStoreSet) => Promise<R>): Promise<R>;
}

// ── Entity importers (the owning contexts' import use cases) ────────────────

/** What an importer needs beyond the event: identity, destination, reference resolution. */
export interface SyncImportContext {
  auth: SyncAuthContext;
  deviceId: string;
  destination: EntityDestination;
  destinationKey: string;
  now: Date;
  /**
   * Resolve a project reference — a client entity UUID already mapped in this
   * tenant, or a decimal server id — to a server project id OWNED by this
   * tenant. `null` when it resolves to nothing this caller may use.
   */
  resolveProjectId(reference: string): Promise<number | null>;
  /** Same for a ticket reference (parent ticket links). */
  resolveTaskId(reference: string): Promise<number | null>;
}

export type SyncImportOutcome =
  | { ok: true; serverId: string; payload: unknown }
  | { ok: false; status: 'rejected' | 'dependency_pending'; detail: string };

/**
 * The owning bounded context's import use case for one or more entity types.
 * Historical-import isolation (G17) is structural here: an importer writes the
 * domain record and nothing else — no agent dispatch, no notifications, no
 * audit triggers, no learning — because it is handed no collaborator that
 * could do those things.
 */
export interface SyncEntityImporter {
  readonly entityTypes: readonly LocalEntityType[];
  create(event: SyncEventInput, ctx: SyncImportContext, stores: SyncStoreSet): Promise<SyncImportOutcome>;
  update(event: SyncEventInput, ctx: SyncImportContext, stores: SyncStoreSet, serverId: string): Promise<SyncImportOutcome>;
  delete(event: SyncEventInput, ctx: SyncImportContext, stores: SyncStoreSet, serverId: string): Promise<SyncImportOutcome>;
}

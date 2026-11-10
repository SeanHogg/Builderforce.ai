/**
 * Application — Synchronization ports.
 *
 * The narrow interfaces the batch sync use cases (`handleSyncPush`,
 * `handleSyncPull`) depend on. Persistence implements them ONCE in
 * `infrastructure/repositories/SyncRepository.ts`; the HTTP route never sees a
 * table. Keeping them here — consumer-side — is what lets the focused tests
 * drive the whole push/pull protocol against the in-memory fake in
 * `__fixtures__/memorySyncStores.ts`.
 */

import type { SyncWatermark } from '../../domain/sync/deltaWatermark';
import type {
  EntityDestination,
  JournalEvent,
  LocalEntityType,
  LocalRecord,
  SyncReceiptStatus,
} from '../../domain/sync/syncProtocol';
import type { RecordUsageRow } from '../llm/usageLedger';

/** The authenticated caller a sync request runs as. Tenant comes from auth only. */
export interface SyncAuthContext {
  tenantId: number;
  userId: string;
  role: string;
}

/** One event of a push batch, exactly as the wire contract carries it. */
export type SyncEventInput = JournalEvent<unknown>;

/** What the event journal answers for a replayed (tenant, device, eventId). */
export interface StoredSyncEvent {
  /** The event's entity type, so a replayed receipt answers the same `syncId` the first did. */
  entityType?: string;
  batchId: string;
  status: SyncReceiptStatus;
  serverId: string | null;
  serverVersion: number | null;
  detail: string | null;
  receivedAt: Date;
  /** The hash of the payload the CLIENT sent — a replay must carry the same one. */
  payloadHash: string;
}

/** The client↔server identity mapping plus its optimistic-concurrency counter. */
export interface SyncEntityMappingRow {
  serverId: string;
  /**
   * The stored `sync_id` (migration 1339): null when the entity has no integer key, or on a row
   * written before the column existed. Read through `mappedServerKey` (`syncIds.ts`), never alone.
   */
  syncId?: number | null;
  serverVersion: number;
  payloadHash: string;
  destinationKey: string;
  /** The projection's tombstone, when the entity was deleted through sync. */
  deletedAt?: Date | null;
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
export interface SyncChangeRow extends SyncWatermark {
  record: LocalRecord;
}

/** One delta page and the database `xmin` of the SAME statement that read it. */
export interface SyncChangePage {
  rows: SyncChangeRow[];
  /** `pg_snapshot_xmin` (decimal `xid8`): every row below it is final. */
  xmin: string;
}

/** The journal row a terminal outcome writes (accepted or conflict). */
export interface SyncEventRow {
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
}

/**
 * The stores a sync transaction sees. ONE factory-bound set per unit of work,
 * so the importer's domain write, the mapping bump, the projection, the
 * change-log entry and the receipt either all commit or all roll back (G16).
 */
export interface SyncStoreSet {
  /** The stored receipt for a replayed event, or null when the event is new. */
  findEvent(tenantId: number, deviceId: string, eventId: string): Promise<StoredSyncEvent | null>;
  /**
   * Persist the event AND its receipt. Only terminal outcomes are stored —
   * `dependency_pending` stays retryable. A concurrent insert of the same
   * (tenant, device, event) violates the unique index and rolls the unit back.
   */
  insertEvent(row: SyncEventRow): Promise<void>;
  /** Of the given event ids, the ones already accepted in this tenant. */
  acceptedEventIds(tenantId: number, eventIds: readonly string[]): Promise<Set<string>>;
  findMapping(tenantId: number, entityType: LocalEntityType, clientEntityId: string): Promise<SyncEntityMappingRow | null>;
  upsertMapping(row: {
    tenantId: number;
    entityType: LocalEntityType;
    clientEntityId: string;
    /** Text id, kept for older devices until the contract push drops it. */
    serverId: string;
    /** `sync_id`: the server row's integer key (`syncIdOf`); null or absent when it has none. */
    syncId?: number | null;
    serverVersion: number;
    destinationKey: string;
    payloadHash: string;
    createdByDevice: string;
    now: Date;
  }): Promise<void>;
  /** Insert or replace the projection row pull serves for this entity. */
  upsertRecord(row: SyncRecordRow & { tenantId: number; receivedAt: Date; payloadHash: string }): Promise<void>;
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

/** Read side of pull — deliberately NOT transactional (one cursor page is one read). */
export interface SyncPullStore {
  /**
   * The database `xmin` (`pg_snapshot_xmin(pg_current_snapshot())`, decimal `xid8`): every
   * transaction below it has finished. A snapshot's delta handover starts here.
   */
  databaseXmin(): Promise<string>;
  /** The lowest retained `(txid, seq)` for this destination; null when it has none. */
  minChangeWatermark(tenantId: number, destinationKey: string): Promise<SyncWatermark | null>;
  /**
   * Delta page: this destination's COMMITTED-AND-FINAL changes after `after` in `(txid, seq)`
   * order, at most `limit` — only rows with `txid < xmin`, with that `xmin` returned from the
   * same statement so the caller holds one consistent snapshot.
   */
  changesAfter(tenantId: number, destinationKey: string, after: SyncWatermark, limit: number): Promise<SyncChangePage>;
  /** Snapshot page: projection rows keyset-paginated by (entityType, clientEntityId). */
  snapshotAfter(
    tenantId: number,
    destinationKey: string,
    after: { entityType: string; clientEntityId: string } | null,
    limit: number,
  ): Promise<SyncRecordRow[]>;
}

/**
 * Tenant-scoped reads of OTHER contexts a sync request needs to decide, never to
 * write: whether a referenced project/ticket is the caller's tenant's, and
 * whether an assignee is a member of it.
 */
export interface SyncReferenceReader {
  projectInTenant(tenantId: number, projectId: number): Promise<boolean>;
  taskInTenant(tenantId: number, taskId: number): Promise<boolean>;
  /** An ACTIVE membership of `userId` in the tenant. */
  tenantMember(tenantId: number, userId: string): Promise<boolean>;
  /** Whether the chat is `userId`'s own chat in the tenant (PRD 36.4). */
  chatOwnedBy(tenantId: number, userId: string, chatId: number): Promise<boolean>;
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
  /** Whether `userId` is an active member of the caller's tenant (assignees). */
  isTenantMember(userId: string): Promise<boolean>;
  /**
   * A server chat id, when it is the CALLER'S own chat in this tenant — the only chat a
   * sync import may adopt or write history into. `null` otherwise.
   */
  resolveOwnChatId(chatId: number): Promise<number | null>;
  /**
   * Register work to run only AFTER the push's unit of work commits (cache bumps). Never
   * run when the unit rolls back, so a cache is never orphaned for a write that did not land.
   */
  afterCommit(effect: () => Promise<unknown>): void;
}

/** Mapping fields the push persists beside the receipt. */
export interface SyncImportMapping {
  serverId: string;
  serverVersion: number;
  payloadHash: string;
  destinationKey: string;
}

/**
 * Importer outcome. `conflict` is first-class — the push must not collapse a
 * stale base version into a generic rejection or a blind overwrite.
 */
export type BoundedImportOutcome =
  /** `detail`: why part of the event was not applied (e.g. the optional chat link was dropped). */
  | ({ status: 'applied'; payload: unknown; detail?: string } & SyncImportMapping)
  | ({ status: 'conflict'; detail: string } & SyncImportMapping)
  | { status: 'rejected'; detail: string }
  /**
   * The entity's parent has not landed yet (a message whose chat is not mapped).
   * Answered `dependency_pending` and NOTHING is written, so the event stays
   * retryable — the same hold an unmet `dependsOn` gets before the importer runs.
   */
  | { status: 'pending'; detail: string };

/**
 * One owning context's import use case, already bound to the unit of work's
 * transaction. Historical-import isolation (G17) is structural: it is handed
 * no collaborator that could dispatch an agent, notify, or trigger an audit.
 */
export type SyncMutationImporter = (
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
) => Promise<BoundedImportOutcome>;

/**
 * The named importers a push may call. There is no generic writer: each one is the
 * owning context's import use case (ticket, project, the Brain chat, its messages, the
 * usage ledger) or the history-only mirror.
 */
export interface SyncNamedImporters {
  importSyncedTicket: SyncMutationImporter;
  importSyncedProject: SyncMutationImporter;
  importSyncedChat: SyncMutationImporter;
  importSyncedMessage: SyncMutationImporter;
  importSyncedUsage: SyncMutationImporter;
  importSyncedChatTicketLink: SyncMutationImporter;
  importMirrorRecord: SyncMutationImporter;
}

/**
 * The usage ledger as the usage importer sees it (PRD 36.4). `llm_usage_log` lives in
 * a DIFFERENT database than the push's unit of work, so its writes cannot ride the
 * sync transaction: a retried event is deduped by the row's idempotency key instead.
 */
export interface SyncUsageLedger {
  /**
   * Write one row through the canonical ledger writer, once per idempotency key: a row
   * already written under the key is a no-op. THROWS when the write fails, so the
   * importer answers it as retryable rather than applied.
   */
  record(row: RecordUsageRow): Promise<void>;
}

/**
 * A chat's run STEPS as the message importer sees them. Steps are run telemetry on the
 * operational endpoint (`brain_chat_steps`), not transcript rows, so — like the usage
 * ledger — their writes cannot ride the sync transaction; a retry is deduped by the
 * step's `event_key`.
 */
export interface SyncStepStore {
  /** Write one step; the stored step's id (the existing one for a replayed key). */
  append(tenantId: number, chatId: number, step: { metadata: string; eventKey: string | null; createdAt: Date }): Promise<number | null>;
  /** The chat a tenant's step is on, or null when there is no such step. */
  chatOf(tenantId: number, stepId: number): Promise<number | null>;
  /** Rewrite a step's metadata; null when the chat holds no such step. */
  update(chatId: number, stepId: number, metadata: string): Promise<number | null>;
  remove(chatId: number, stepId: number): Promise<void>;
}

/** Everything one atomic event apply writes through: sync stores AND importers, one transaction. */
export interface SyncUnitOfWork {
  stores: SyncStoreSet;
  importers: SyncNamedImporters;
}

/**
 * One push batch's transaction. `stores`/`importers` are bound to the BATCH
 * transaction itself; each event runs through {@link savepoint}.
 */
export interface SyncBatchUnit extends SyncUnitOfWork {
  /**
   * Cross-context reference reads bound to THIS transaction: a row an earlier event of
   * the batch wrote (a chat it created) is invisible to a committed read on another
   * connection, and visible here.
   */
  references: SyncReferenceReader;
  /**
   * Run `work` in a SAVEPOINT. A throw rolls back to the savepoint (this event's writes
   * only, and the transaction is usable again) and rethrows; a return releases it.
   */
  savepoint<R>(work: (unit: SyncUnitOfWork) => Promise<R>): Promise<R>;
}

/**
 * The full persistence port: committed reads (replay lookup, dependency check,
 * destination binding, pull), plus ONE transaction per push batch.
 */
export interface SyncStores
  extends SyncPullStore, Pick<SyncStoreSet, 'findEvent' | 'acceptedEventIds' | 'findMapping'> {
  references: SyncReferenceReader;
  /** One transaction around the whole batch; a throw out of `work` rolls the batch back. */
  transact<R>(work: (batch: SyncBatchUnit) => Promise<R>): Promise<R>;
}

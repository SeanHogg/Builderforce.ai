/**
 * In-memory `SyncStores` for the sync use-case tests.
 *
 * Mirrors the real adapter's contract where it matters to the protocol:
 * - `transact` works on a draft and publishes it only if the unit of work
 *   returns — a throw (including an importer throw) rolls everything back;
 * - the receipt journal is unique on (tenant, device, event): a second insert
 *   throws a 23505-shaped error naming `uq_sync_events_event`;
 * - `sync_changes.seq` is ONE global sequence across tenants and destinations
 *   (`advanceGlobalSeq` simulates other tenants writing), so cursor tests see
 *   the gaps production sees.
 */

import type { LocalRecord } from '../../../domain/sync/syncProtocol';
import type {
  StoredSyncEvent,
  SyncEntityMappingRow,
  SyncEventRow,
  SyncNamedImporters,
  SyncRecordRow,
  SyncReferenceReader,
  SyncStores,
  SyncStoreSet,
} from '../syncPorts';

interface MappingRow extends SyncEntityMappingRow {
  tenantId: number;
  entityType: string;
  clientEntityId: string;
}

interface RecordRow extends SyncRecordRow {
  tenantId: number;
}

interface ChangeRow {
  seq: number;
  tenantId: number;
  destinationKey: string;
  recordedAt: Date;
  record: LocalRecord;
}

export interface MemorySyncState {
  events: SyncEventRow[];
  mappings: MappingRow[];
  records: RecordRow[];
  changes: ChangeRow[];
  seq: number;
}

export interface MemorySyncStores extends SyncStores {
  state(): MemorySyncState;
  /** Simulate writes elsewhere in the global change sequence. */
  advanceGlobalSeq(by: number): void;
  /** Drop change rows older than `cutoff` (the retention sweep). */
  sweepChanges(cutoff: Date): void;
  /** Units of work that committed / rolled back. */
  commits(): number;
  rollbacks(): number;
}

export interface MemorySyncStoresOptions {
  importers: SyncNamedImporters;
  references?: Partial<SyncReferenceReader>;
  /** Clock stamped on change rows (`recorded_at`). */
  now?: () => Date;
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint "uq_sync_events_event"'), {
    code: '23505',
  });
}

function storedEvent(row: SyncEventRow): StoredSyncEvent {
  return {
    batchId: row.batchId,
    status: row.status,
    serverId: row.serverId,
    serverVersion: row.serverVersion,
    detail: row.detail,
    receivedAt: row.receivedAt,
    payloadHash: row.payloadHash,
  };
}

function storeSet(target: MemorySyncState, now: () => Date): SyncStoreSet {
  return {
    async findEvent(tenantId, deviceId, eventId) {
      const row = target.events.find((e) => e.tenantId === tenantId && e.deviceId === deviceId && e.eventId === eventId);
      return row ? storedEvent(row) : null;
    },
    async insertEvent(row) {
      if (target.events.some((e) => e.tenantId === row.tenantId && e.deviceId === row.deviceId && e.eventId === row.eventId)) {
        throw uniqueViolation();
      }
      target.events.push(structuredClone(row));
    },
    async acceptedEventIds(tenantId, eventIds) {
      const settled = new Set(
        target.events
          .filter((e) => e.tenantId === tenantId && (e.status === 'accepted' || e.status === 'duplicate'))
          .map((e) => e.eventId),
      );
      return new Set(eventIds.filter((id) => settled.has(id)));
    },
    async findMapping(tenantId, entityType, clientEntityId) {
      const row = target.mappings.find((m) => m.tenantId === tenantId && m.entityType === entityType && m.clientEntityId === clientEntityId);
      if (!row) return null;
      const record = target.records.find((r) => r.tenantId === tenantId && r.entityType === entityType && r.clientEntityId === clientEntityId);
      return {
        serverId: row.serverId,
        serverVersion: row.serverVersion,
        payloadHash: row.payloadHash,
        destinationKey: row.destinationKey,
        deletedAt: record?.deletedAt ?? null,
      };
    },
    async upsertMapping(row) {
      const next: MappingRow = {
        tenantId: row.tenantId,
        entityType: row.entityType,
        clientEntityId: row.clientEntityId,
        serverId: row.serverId,
        serverVersion: row.serverVersion,
        destinationKey: row.destinationKey,
        payloadHash: row.payloadHash,
      };
      const existing = target.mappings.find(
        (m) => m.tenantId === row.tenantId && m.entityType === row.entityType && m.clientEntityId === row.clientEntityId,
      );
      if (existing) Object.assign(existing, next);
      else target.mappings.push(next);
    },
    async upsertRecord(row) {
      const next: RecordRow = {
        tenantId: row.tenantId,
        entityType: row.entityType,
        clientEntityId: row.clientEntityId,
        serverId: row.serverId,
        schemaVersion: row.schemaVersion,
        version: row.version,
        destinationKey: row.destinationKey,
        occurredAt: row.occurredAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
        payload: structuredClone(row.payload),
        provenance: { ...row.provenance },
      };
      const existing = target.records.find(
        (r) => r.tenantId === row.tenantId && r.entityType === row.entityType && r.clientEntityId === row.clientEntityId,
      );
      if (existing) Object.assign(existing, next);
      else target.records.push(next);
    },
    async appendChange(row) {
      target.seq += 1;
      target.changes.push({
        seq: target.seq,
        tenantId: row.tenantId,
        destinationKey: row.destinationKey,
        recordedAt: now(),
        record: structuredClone(row.record),
      });
    },
  };
}

export function createMemorySyncStores(options: MemorySyncStoresOptions): MemorySyncStores {
  const now = options.now ?? (() => new Date());
  let state: MemorySyncState = { events: [], mappings: [], records: [], changes: [], seq: 0 };
  let commits = 0;
  let rollbacks = 0;
  const committed = () => storeSet(state, now);
  const references: SyncReferenceReader = {
    projectInTenant: async () => false,
    taskInTenant: async () => false,
    tenantMember: async () => false,
    chatOwnedBy: async () => false,
    ...options.references,
  };

  return {
    references,
    findEvent: (...args) => committed().findEvent(...args),
    acceptedEventIds: (...args) => committed().acceptedEventIds(...args),
    findMapping: (...args) => committed().findMapping(...args),
    async transact(work) {
      const draft = structuredClone(state);
      try {
        const result = await work({ stores: storeSet(draft, now), importers: options.importers });
        state = draft;
        commits += 1;
        return result;
      } catch (error) {
        rollbacks += 1;
        throw error;
      }
    },
    async maxChangeSeq(tenantId) {
      return state.changes.filter((c) => c.tenantId === tenantId).reduce((max, c) => Math.max(max, c.seq), 0);
    },
    async minChangeSeq(tenantId, destinationKey) {
      const seqs = state.changes.filter((c) => c.tenantId === tenantId && c.destinationKey === destinationKey).map((c) => c.seq);
      return seqs.length === 0 ? null : Math.min(...seqs);
    },
    async changesAfter(tenantId, destinationKey, seq, limit) {
      return state.changes
        .filter((c) => c.tenantId === tenantId && c.destinationKey === destinationKey && c.seq > seq)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit)
        .map((c) => ({ seq: c.seq, record: structuredClone(c.record) }));
    },
    async snapshotAfter(tenantId, destinationKey, after, limit) {
      return state.records
        .filter((r) => r.tenantId === tenantId && r.destinationKey === destinationKey)
        .filter((r) => !after
          || r.entityType > after.entityType
          || (r.entityType === after.entityType && r.clientEntityId > after.clientEntityId))
        .sort((a, b) => (a.entityType === b.entityType
          ? (a.clientEntityId < b.clientEntityId ? -1 : 1)
          : (a.entityType < b.entityType ? -1 : 1)))
        .slice(0, limit)
        .map(({ tenantId: _tenant, ...row }) => structuredClone(row));
    },
    state: () => state,
    advanceGlobalSeq(by) {
      state.seq += by;
    },
    sweepChanges(cutoff) {
      state.changes = state.changes.filter((c) => c.recordedAt >= cutoff);
    },
    commits: () => commits,
    rollbacks: () => rollbacks,
  };
}

/**
 * In-memory `SyncStores` for the sync use-case tests.
 *
 * Mirrors the real adapter's contract where it matters to the protocol:
 * - `transact` is ONE transaction per push batch: it works on a draft and
 *   publishes it only if the batch returns — a throw rolls everything back.
 *   Each event runs in a `savepoint`: a throw restores the draft to its state at
 *   entry (that event's writes only) and rethrows. `commits()`/`rollbacks()`
 *   count savepoints (per-event units); `batchCommits()`/`batchRollbacks()`
 *   count whole transactions;
 * - every transaction takes a txid and `xmin` is the oldest one still open, so
 *   pulls see only rows below it (`beginForeignTransaction` holds one open);
 * - the receipt journal is unique on (tenant, device, event): a second insert
 *   throws a 23505-shaped error naming `uq_sync_events_event`;
 * - `sync_changes.seq` is ONE global sequence across tenants and destinations
 *   (`advanceGlobalSeq` simulates other tenants writing), so cursor tests see
 *   the gaps production sees.
 */

import { compareWatermark } from '../../../domain/sync/deltaWatermark';
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
  /** Writing transaction (the model's `xid8`), decimal string. */
  txid: string;
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
  /** Per-event units of work (savepoints) that were released / rolled back. */
  commits(): number;
  rollbacks(): number;
  /** Batch transactions that committed / rolled back. */
  batchCommits(): number;
  batchRollbacks(): number;
  /**
   * A transaction another connection holds open: its rows take their `seq` when written
   * but are invisible until `commit()`, and its txid holds the database `xmin` back until
   * it ends (the late-commit scenario).
   */
  beginForeignTransaction(): MemoryForeignTransaction;
}

export interface MemoryForeignTransaction {
  txid: string;
  write(tenantId: number, destinationKey: string, record: LocalRecord): number;
  commit(): void;
}

export interface MemorySyncStoresOptions {
  importers: SyncNamedImporters;
  references?: Partial<SyncReferenceReader>;
  /**
   * What a read ON THE BATCH TRANSACTION sees (a row an earlier event wrote is invisible to the
   * committed `references`). Defaults to the committed reader.
   */
  referencesInTx?: Partial<SyncReferenceReader>;
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
    entityType: row.entityType,
    batchId: row.batchId,
    status: row.status,
    serverId: row.serverId,
    serverVersion: row.serverVersion,
    detail: row.detail,
    receivedAt: row.receivedAt,
    payloadHash: row.payloadHash,
  };
}

function storeSet(target: MemorySyncState, now: () => Date, txid: string): SyncStoreSet {
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
        syncId: row.syncId ?? null,
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
        syncId: row.syncId ?? null,
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
        txid,
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
  let batchCommits = 0;
  let batchRollbacks = 0;
  // The model of Postgres transaction ids: one per transaction, `xmin` = the oldest still open.
  let nextTxid = 100;
  const inflight = new Set<number>();
  const xmin = (): string => String(inflight.size === 0 ? nextTxid : Math.min(...inflight));
  const committed = () => storeSet(state, now, '0');
  const references: SyncReferenceReader = {
    projectInTenant: async () => false,
    taskInTenant: async () => false,
    tenantMember: async () => false,
    chatOwnedBy: async () => false,
    ...options.references,
  };
  const referencesInTx: SyncReferenceReader = { ...references, ...options.referencesInTx };

  return {
    references,
    findEvent: (...args) => committed().findEvent(...args),
    acceptedEventIds: (...args) => committed().acceptedEventIds(...args),
    findMapping: (...args) => committed().findMapping(...args),
    async transact(work) {
      const txid = nextTxid;
      nextTxid += 1;
      inflight.add(txid);
      const draft = structuredClone(state);
      try {
        const result = await work({
          stores: storeSet(draft, now, String(txid)),
          importers: options.importers,
          references: referencesInTx,
          // A SAVEPOINT: a throw restores the draft to its state at entry and rethrows. The
          // sequence is NOT rolled back (Postgres sequences never are), so gaps stay realistic.
          async savepoint(inner) {
            const saved = structuredClone(draft);
            try {
              const out = await inner({ stores: storeSet(draft, now, String(txid)), importers: options.importers });
              commits += 1;
              return out;
            } catch (error) {
              const seq = draft.seq;
              Object.assign(draft, saved, { seq });
              rollbacks += 1;
              throw error;
            }
          },
        });
        state = draft;
        batchCommits += 1;
        return result;
      } catch (error) {
        batchRollbacks += 1;
        throw error;
      } finally {
        inflight.delete(txid);
      }
    },
    beginForeignTransaction() {
      const txid = nextTxid;
      nextTxid += 1;
      inflight.add(txid);
      const pending: ChangeRow[] = [];
      return {
        txid: String(txid),
        write(tenantId, destinationKey, record) {
          state.seq += 1;
          pending.push({ seq: state.seq, txid: String(txid), tenantId, destinationKey, recordedAt: now(), record: structuredClone(record) });
          return state.seq;
        },
        commit() {
          state.changes.push(...pending);
          inflight.delete(txid);
        },
      };
    },
    async databaseXmin() {
      return xmin();
    },
    async minChangeWatermark(tenantId, destinationKey) {
      const rows = state.changes
        .filter((c) => c.tenantId === tenantId && c.destinationKey === destinationKey)
        .map(({ txid, seq }) => ({ txid, seq }))
        .sort(compareWatermark);
      return rows[0] ?? null;
    },
    async changesAfter(tenantId, destinationKey, after, limit) {
      const horizon = xmin();
      const rows = state.changes
        .filter((c) => c.tenantId === tenantId && c.destinationKey === destinationKey)
        .filter((c) => compareWatermark(c, after) > 0 && BigInt(c.txid) < BigInt(horizon))
        .sort(compareWatermark)
        .slice(0, limit)
        .map((c) => ({ txid: c.txid, seq: c.seq, record: structuredClone(c.record) }));
      return { rows, xmin: horizon };
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
    batchCommits: () => batchCommits,
    batchRollbacks: () => batchRollbacks,
  };
}

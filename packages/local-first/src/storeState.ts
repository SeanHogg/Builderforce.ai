/**
 * The COMMITTED state of a local-first store: long-lived Maps, mutated only by
 * `applyDelta`.
 *
 * Every way state changes — a transaction publishing, another window's commit being
 * applied, a journal being folded on open — is the same step: apply one
 * `LocalFirstDelta`. That is what lets a journal store ONE delta per commit and replay
 * it anywhere, and why the state never has to be re-indexed per transaction.
 *
 * Rows of a PARTITIONED type (`recordPartition.ts`) are not in `records`: they live in the
 * `PartitionTable`'s segments, and only their stubs are always in memory.
 */

import { destinationKey, normalizeServerMapping, type JournalEvent, type LocalEntityType, type LocalRecord, type ServerMapping, type SyncConflict, type SyncReceipt } from './records.js';
import { ChangeBuilder, type LocalFirstChange, type LocalFirstDelta } from './localFirstDelta.js';
import type { LocalFirstSnapshot } from './storeContract.js';
import { RecordGroups, recordIndexId, sameRecordIndex, type RecordIndex, type RecordIndexKey } from './recordIndex.js';
import { PendingCounts, PendingEntityIndex, PendingKeyIndex } from './pendingIndexes.js';
import { PartitionTable } from './partitionTable.js';
import { stubOf, type AnyRecordPartition, type PartitionLoader, type RecordPartition } from './recordPartition.js';
import { CompositeRecords } from './compositeRecords.js';
import { recordKey } from './recordKey.js';

export { recordKey, splitRecordKey } from './recordKey.js';
export const mappingKey = (mapping: Pick<ServerMapping, 'entityType' | 'clientEntityId' | 'destination'>): string =>
  `${destinationKey(mapping.destination)}:${mapping.entityType}:${mapping.clientEntityId}`;

export class CommittedState {
  /** The UNPARTITIONED rows. A partitioned type's rows are in `table`'s segments. */
  readonly records = new Map<string, LocalRecord>();
  readonly events = new Map<string, JournalEvent>();
  /** The committed events by the row they write (`PendingEntityIndex`). */
  readonly pendingEntities = new PendingEntityIndex();
  /** The committed events counted per partition (`PendingCounts`). */
  readonly pendingCounts = new PendingCounts();
  readonly mappings = new Map<string, ServerMapping>();
  readonly receipts = new Map<string, SyncReceipt>();
  readonly conflicts = new Map<string, SyncConflict>();
  readonly cursors = new Map<string, string>();
  readonly pendingKeys = new PendingKeyIndex();
  /** Stubs, pointers and segments of the partitioned types (empty, and free, for a store with none). */
  readonly table = new PartitionTable();
  /**
   * The per-type scan index: the committed rows by entity type, by id, in committed
   * insertion order. A `scan(type)` walks ONLY this type's rows — and walks the rows
   * themselves, with no key to build or look up per row. A row's position follows the
   * records Map exactly: an update keeps its place, a delete-and-re-add lands at the end.
   */
  readonly recordTypes = new Map<string, Map<string, LocalRecord>>();
  /** The secondary indexes built so far (`recordIndex.ts`), by the entity type they group. */
  private readonly indexes = new Map<string, RecordGroups[]>();
  /** The same built indexes by `entityType:name` (`recordIndexId`): one per declaration, however many copies of it load. */
  private readonly indexById = new Map<string, RecordGroups>();
  nextSequence = 1;
  /** The highest `mappedSeq` any committed mapping carries: a new mapping takes the next one. */
  maxMappedSeq = 0;

  noteMappedSeq(seq: number | undefined): void {
    if (seq !== undefined && seq > this.maxMappedSeq) this.maxMappedSeq = seq;
  }

  /**
   * Commit one (normalised) mapping. A row without a `mappedSeq` (an older window's write) keeps the
   * sequence of the row it replaces, or takes the next one — so "earliest" never moves on an update.
   */
  private adoptMapping(mapping: ServerMapping): void {
    const key = mappingKey(mapping);
    let row = mapping;
    if (row.mappedSeq === undefined) {
      row = { ...row, mappedSeq: this.mappings.get(key)?.mappedSeq ?? this.maxMappedSeq + 1 };
    }
    this.noteMappedSeq(row.mappedSeq);
    this.mappings.set(key, row);
  }

  /**
   * Commit one row. A row of a partitioned type that has a home goes to its segment (and its
   * stub is rebuilt from the row itself, so a stub can never disagree with the row it names);
   * every other row goes to the records Map, the per-type rows and every built index of its type.
   */
  private putRecord(record: LocalRecord, carried: Set<string>, force = false): void {
    const partition = this.table.partitionOf(record.entityType);
    const stub = partition && stubOf(partition, record);
    if (stub) {
      this.removeMain(record.entityType, record.id); // a row that gained a home leaves the main state
      this.table.applyRow(stub, record, carried, force);
      return;
    }
    this.table.deleteRow(record.entityType, record.id); // a row that lost its home leaves its segment
    this.records.set(recordKey(record.entityType, record.id), record);
    let rows = this.recordTypes.get(record.entityType);
    if (!rows) this.recordTypes.set(record.entityType, (rows = new Map()));
    rows.set(record.id, record); // an update keeps its position
    for (const groups of this.indexes.get(record.entityType) ?? []) groups.put(record);
  }

  private removeMain(entityType: LocalEntityType, id: string): void {
    if (!this.records.delete(recordKey(entityType, id))) return;
    this.recordTypes.get(entityType)?.delete(id);
    for (const groups of this.indexes.get(entityType) ?? []) groups.remove(id);
  }

  /** Remove a row wherever it lives: its stub says a segment, otherwise the main state. */
  private removeRecord(entityType: LocalEntityType, id: string, carried: Set<string>): void {
    if (this.table.stub(entityType, id)) this.table.deleteRow(entityType, id, carried);
    else this.removeMain(entityType, id);
  }

  /** The committed UNPARTITIONED rows of `entityType` by id, in committed order. */
  typeRows(entityType: LocalEntityType): ReadonlyMap<string, LocalRecord> | undefined {
    return this.recordTypes.get(entityType);
  }

  /** The records Map a transaction reads through: the main rows, plus the loaded segments when any type is partitioned. */
  recordsBase(): ReadonlyMap<string, LocalRecord> {
    return this.table.enabled ? new CompositeRecords(this.records, this.table) : this.records;
  }

  /**
   * The committed live rows of one group of `index` (order unspecified). The first read
   * through an index builds it from the type's rows (once, O(rows of the type)); every later
   * `applyDelta` keeps it current, so a read costs the group, never the type.
   */
  indexGroup(index: RecordIndex, key: RecordIndexKey): ReadonlyMap<string, LocalRecord> | undefined {
    return this.groupsOf(index).group(key);
  }

  private groupsOf(index: RecordIndex): RecordGroups {
    const id = recordIndexId(index);
    const found = this.indexById.get(id);
    if (found) {
      // A second declaration under a taken name would silently read the first one's groups.
      if (!sameRecordIndex(found.index, index)) throw new Error(`local_first_index_conflict: ${id} is declared with two different keyOf functions`);
      return found;
    }
    const groups = new RecordGroups(index);
    for (const record of this.recordTypes.get(index.entityType)?.values() ?? []) groups.put(record);
    const built = this.indexes.get(index.entityType);
    if (built) built.push(groups);
    else this.indexes.set(index.entityType, [groups]);
    this.indexById.set(id, groups);
    return groups;
  }

  /** Index a snapshot. The rows are adopted, not cloned: nothing mutates a committed row. */
  static from(initial?: Partial<LocalFirstSnapshot>): CommittedState {
    const state = new CommittedState();
    state.table.restore(initial ?? {});
    const carried = new Set<string>(); // nothing settles after a snapshot: only a delta moves pointers
    for (const record of initial?.records ?? []) state.putRecord(record, carried);
    for (const event of initial?.events ?? []) state.events.set(event.eventId, event);
    // Legacy rows (no `syncId`, `kind:ref` in `serverId`) are read through the ONE normaliser; nothing is dropped.
    // A legacy row without a `mappedSeq` gets the next one AFTER every persisted one, in load order.
    const loaded = (initial?.mappings ?? []).map(normalizeServerMapping);
    for (const mapping of loaded) state.noteMappedSeq(mapping.mappedSeq);
    for (const mapping of loaded) state.adoptMapping(mapping);
    for (const receipt of initial?.receipts ?? []) state.receipts.set(receipt.eventId, receipt);
    for (const conflict of initial?.conflicts ?? []) state.conflicts.set(conflict.id, conflict);
    for (const [key, cursor] of Object.entries(initial?.cursors ?? {})) state.cursors.set(key, cursor);
    for (const event of state.events.values()) {
      state.pendingKeys.add(event);
      state.pendingEntities.add(event);
      state.pendingCounts.add(event);
    }
    state.nextSequence = initial?.nextSequence ?? 1;
    return state;
  }

  /**
   * Declare which types are partitioned and how their partitions are read. Rows of those types
   * already in the main state (a store opened from a snapshot that predates the partition) move
   * into their segments, in order, so there is one place a row can be.
   */
  configurePartitions(declared: readonly AnyRecordPartition[], loader?: PartitionLoader): void {
    const partitions = declared as readonly RecordPartition[];
    this.table.configure(partitions, loader);
    const carried = new Set<string>();
    for (const partition of partitions) {
      for (const record of [...(this.recordTypes.get(partition.index.entityType)?.values() ?? [])]) {
        if (stubOf(partition, record)) this.putRecord(record, carried, true);
      }
    }
  }

  /** Bring these partitions' segments current (`PartitionTable.load`). A load commits nothing and notifies nobody. */
  async ensureLoaded(partitionIds: Iterable<string>): Promise<void> {
    await this.table.load(partitionIds);
  }

  /**
   * Apply one commit. Deletions first, then upserts (see `localFirstDelta.ts`). Returns what
   * changed, or `undefined` for a `reset` — everything changed, which is what a listener
   * is told when the change is unknown.
   */
  applyDelta(delta: LocalFirstDelta): LocalFirstChange | undefined {
    const change = new ChangeBuilder();
    if (delta.reset) this.clear();
    // Pointers first: whether a partitioned row is kept in memory depends on whether it has one.
    const moved = this.table.setPointers(delta.partitionPointers);
    this.table.declare(delta.partitionDeclarations);
    const carried = new Set<string>();
    for (const gone of delta.deletedRecords ?? []) {
      this.removeRecord(gone.entityType, gone.id, carried);
      change.record(gone.entityType, gone.id);
    }
    for (const gone of delta.deletedStubs ?? []) {
      this.table.deleteRow(gone.entityType, gone.id);
      change.record(gone.entityType, gone.id);
    }
    // A stub-only change (another window's commit to a partition this one never loaded) still names the row.
    for (const stub of delta.stubs ?? []) {
      this.table.putStub(stub);
      change.record(stub.entityType, stub.id);
    }
    for (const id of delta.acknowledgedEvents ?? []) {
      const event = this.events.get(id);
      if (!event) continue;
      this.events.delete(id);
      this.pendingKeys.remove(event);
      this.pendingEntities.remove(event);
      this.pendingCounts.remove(event);
      change.event();
    }
    for (const key of delta.unsetCursors ?? []) {
      this.cursors.delete(key);
      change.sync();
    }
    for (const record of delta.records ?? []) {
      this.putRecord(record, carried);
      change.record(record.entityType, record.id);
    }
    for (const event of delta.events ?? []) {
      const replaced = this.events.get(event.eventId);
      if (replaced) {
        this.pendingKeys.remove(replaced);
        this.pendingEntities.remove(replaced);
        this.pendingCounts.remove(replaced);
      }
      this.events.set(event.eventId, event);
      this.pendingKeys.add(event);
      this.pendingEntities.add(event);
      this.pendingCounts.add(event);
      change.event();
    }
    for (const raw of delta.mappings ?? []) {
      this.adoptMapping(normalizeServerMapping(raw));
      change.sync();
    }
    for (const id of delta.prunedReceipts ?? []) {
      if (this.receipts.delete(id)) change.sync();
    }
    for (const receipt of delta.receipts ?? []) {
      this.receipts.set(receipt.eventId, receipt);
      change.sync();
    }
    for (const conflict of delta.conflicts ?? []) {
      this.conflicts.set(conflict.id, conflict);
      change.sync();
    }
    for (const [key, cursor] of Object.entries(delta.cursors ?? {})) {
      this.cursors.set(key, cursor);
      change.sync();
    }
    if (delta.nextSequence !== undefined) this.nextSequence = delta.nextSequence;
    this.table.settle(moved, carried);
    return delta.reset ? undefined : change.build();
  }

  /**
   * Shallow copy of the arrays: the rows inside are the state's own — read-only to the caller.
   * Holds the UNPARTITIONED rows plus the stubs, pointers and declarations; it never loads.
   */
  view(): LocalFirstSnapshot {
    return { ...this.snapshotOf([...this.records.values()]), ...this.table.view() };
  }

  /** The WHOLE store as one plain snapshot: loads every partition, so every row is in `records`. */
  async fullView(): Promise<LocalFirstSnapshot> {
    await this.ensureLoaded(this.table.allPartitionIds());
    return this.snapshotOf([...this.records.values(), ...this.table.loadedRows()]);
  }

  private snapshotOf(records: LocalRecord[]): LocalFirstSnapshot {
    return {
      records,
      events: [...this.events.values()],
      mappings: [...this.mappings.values()],
      receipts: [...this.receipts.values()],
      conflicts: [...this.conflicts.values()],
      cursors: Object.fromEntries(this.cursors),
      nextSequence: this.nextSequence,
    };
  }

  private clear(): void {
    this.records.clear();
    this.recordTypes.clear();
    // A reset keeps the indexes DECLARED and empties them: the reset's own rows refill them.
    for (const built of this.indexes.values()) for (const groups of built) groups.clear();
    this.events.clear();
    this.mappings.clear();
    this.receipts.clear();
    this.conflicts.clear();
    this.cursors.clear();
    this.pendingKeys.clear();
    this.pendingEntities.clear();
    this.pendingCounts.clear();
    this.table.clear();
    this.nextSequence = 1;
    this.maxMappedSeq = 0;
  }
}

/**
 * The COMMITTED state of a local-first store: long-lived Maps, mutated only by
 * `applyDelta`.
 *
 * Every way state changes — a transaction publishing, another window's commit being
 * applied, a journal being folded on open — is the same step: apply one
 * `LocalFirstDelta`. That is what lets a journal store ONE delta per commit and replay
 * it anywhere, and why the state never has to be re-indexed per transaction.
 */

import { destinationKey, normalizeServerMapping, type JournalEvent, type LocalEntityType, type LocalRecord, type ServerMapping, type SyncConflict, type SyncReceipt } from './records.js';
import { ChangeBuilder, type LocalFirstChange, type LocalFirstDelta } from './localFirstDelta.js';
import type { LocalFirstSnapshot } from './storeContract.js';
import { RecordGroups, type RecordIndex, type RecordIndexKey } from './recordIndex.js';

export const recordKey = (type: LocalEntityType, id: string): string => `${type}:${id}`;
export const mappingKey = (mapping: Pick<ServerMapping, 'entityType' | 'clientEntityId' | 'destination'>): string =>
  `${destinationKey(mapping.destination)}:${mapping.entityType}:${mapping.clientEntityId}`;

/**
 * Pending events by their caller-side idempotency key, so `append` finds the event a key
 * already names in O(1) instead of walking every event. A key maps to a LIST because a
 * snapshot opened from disk may carry two events with one key; the latest one in
 * iteration order is the one a lookup returns, exactly as a rebuilt Map would.
 */
export class PendingKeyIndex {
  private readonly byKey = new Map<string, JournalEvent[]>();

  add(event: JournalEvent): void {
    if (event.idempotencyKey === undefined) return;
    const list = this.byKey.get(event.idempotencyKey);
    if (list) list.push(event);
    else this.byKey.set(event.idempotencyKey, [event]);
  }

  remove(event: JournalEvent): void {
    if (event.idempotencyKey === undefined) return;
    const list = this.byKey.get(event.idempotencyKey);
    if (!list) return;
    const at = list.lastIndexOf(event);
    if (at >= 0) list.splice(at, 1);
    if (list.length === 0) this.byKey.delete(event.idempotencyKey);
  }

  /** The latest event with this key that `live` still accepts. */
  latest(key: string, live?: (event: JournalEvent) => boolean): JournalEvent | undefined {
    const list = this.byKey.get(key);
    if (!list) return undefined;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const event = list[index]!;
      if (!live || live(event)) return event;
    }
    return undefined;
  }

  clear(): void {
    this.byKey.clear();
  }
}

export class CommittedState {
  readonly records = new Map<string, LocalRecord>();
  readonly events = new Map<string, JournalEvent>();
  readonly mappings = new Map<string, ServerMapping>();
  readonly receipts = new Map<string, SyncReceipt>();
  readonly conflicts = new Map<string, SyncConflict>();
  readonly cursors = new Map<string, string>();
  readonly pendingKeys = new PendingKeyIndex();
  /**
   * The per-type scan index: the committed rows by entity type, by id, in committed
   * insertion order. A `scan(type)` walks ONLY this type's rows — and walks the rows
   * themselves, with no key to build or look up per row. A row's position follows the
   * records Map exactly: an update keeps its place, a delete-and-re-add lands at the end.
   */
  readonly recordTypes = new Map<string, Map<string, LocalRecord>>();
  /** The secondary indexes built so far (`recordIndex.ts`), by the entity type they group. */
  private readonly indexes = new Map<string, RecordGroups[]>();
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

  /** Commit one row: the records Map, the per-type rows and every built index of its type. */
  private putRecord(record: LocalRecord): void {
    this.records.set(recordKey(record.entityType, record.id), record);
    let rows = this.recordTypes.get(record.entityType);
    if (!rows) this.recordTypes.set(record.entityType, (rows = new Map()));
    rows.set(record.id, record); // an update keeps its position
    for (const groups of this.indexes.get(record.entityType) ?? []) groups.put(record);
  }

  private removeRecord(entityType: LocalEntityType, id: string): void {
    this.records.delete(recordKey(entityType, id));
    this.recordTypes.get(entityType)?.delete(id);
    for (const groups of this.indexes.get(entityType) ?? []) groups.remove(id);
  }

  /** The committed rows of `entityType` by id, in committed order — what a typed scan walks. */
  typeRows(entityType: LocalEntityType): ReadonlyMap<string, LocalRecord> | undefined {
    return this.recordTypes.get(entityType);
  }

  /**
   * The committed rows of one group of `index`, in committed order. The first read through
   * an index builds it from the type's rows (once, O(rows of the type)); every later
   * `applyDelta` keeps it current, so a read costs the group, never the type.
   */
  indexGroup(index: RecordIndex, key: RecordIndexKey): ReadonlyMap<string, LocalRecord> | undefined {
    return this.groupsOf(index).group(key);
  }

  private groupsOf(index: RecordIndex): RecordGroups {
    const built = this.indexes.get(index.entityType);
    const found = built?.find((groups) => groups.index === index);
    if (found) return found;
    const groups = new RecordGroups(index);
    for (const record of this.recordTypes.get(index.entityType)?.values() ?? []) groups.put(record);
    if (built) built.push(groups);
    else this.indexes.set(index.entityType, [groups]);
    return groups;
  }

  /** Index a snapshot. The rows are adopted, not cloned: nothing mutates a committed row. */
  static from(initial?: Partial<LocalFirstSnapshot>): CommittedState {
    const state = new CommittedState();
    for (const record of initial?.records ?? []) state.putRecord(record);
    for (const event of initial?.events ?? []) state.events.set(event.eventId, event);
    // Legacy rows (no `syncId`, `kind:ref` in `serverId`) are read through the ONE normaliser; nothing is dropped.
    // A legacy row without a `mappedSeq` gets the next one AFTER every persisted one, in load order.
    const loaded = (initial?.mappings ?? []).map(normalizeServerMapping);
    for (const mapping of loaded) state.noteMappedSeq(mapping.mappedSeq);
    for (const mapping of loaded) state.adoptMapping(mapping);
    for (const receipt of initial?.receipts ?? []) state.receipts.set(receipt.eventId, receipt);
    for (const conflict of initial?.conflicts ?? []) state.conflicts.set(conflict.id, conflict);
    for (const [key, cursor] of Object.entries(initial?.cursors ?? {})) state.cursors.set(key, cursor);
    for (const event of state.events.values()) state.pendingKeys.add(event);
    state.nextSequence = initial?.nextSequence ?? 1;
    return state;
  }

  /**
   * Apply one commit. Deletions first, then upserts (see `localFirstDelta.ts`). Returns what
   * changed, or `undefined` for a `reset` — everything changed, which is what a listener
   * is told when the change is unknown.
   */
  applyDelta(delta: LocalFirstDelta): LocalFirstChange | undefined {
    const change = new ChangeBuilder();
    if (delta.reset) this.clear();
    for (const gone of delta.deletedRecords ?? []) {
      this.removeRecord(gone.entityType, gone.id);
      change.record(gone.entityType, gone.id);
    }
    for (const id of delta.acknowledgedEvents ?? []) {
      const event = this.events.get(id);
      if (!event) continue;
      this.events.delete(id);
      this.pendingKeys.remove(event);
      change.event();
    }
    for (const key of delta.unsetCursors ?? []) {
      this.cursors.delete(key);
      change.sync();
    }
    for (const record of delta.records ?? []) {
      this.putRecord(record);
      change.record(record.entityType, record.id);
    }
    for (const event of delta.events ?? []) {
      const replaced = this.events.get(event.eventId);
      if (replaced) this.pendingKeys.remove(replaced);
      this.events.set(event.eventId, event);
      this.pendingKeys.add(event);
      change.event();
    }
    for (const raw of delta.mappings ?? []) {
      this.adoptMapping(normalizeServerMapping(raw));
      change.sync();
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
    return delta.reset ? undefined : change.build();
  }

  /** Shallow copy of the arrays: the rows inside are the state's own — read-only to the caller. */
  view(): LocalFirstSnapshot {
    return {
      records: [...this.records.values()],
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
    this.nextSequence = 1;
    this.maxMappedSeq = 0;
  }
}

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
   * The per-type scan index: record ids by entity type, in committed insertion order.
   * A `scan(type)` reads ONLY these ids instead of walking every type's rows — reading
   * one chat's messages out of a whole history costs that type's rows, not the store's.
   * A row's position follows the records Map exactly: an update keeps its place, a
   * delete-and-re-add lands at the end (the Set loses the id on delete, re-gains it last).
   */
  readonly recordTypes = new Map<string, Set<string>>();
  nextSequence = 1;

  /** Add a row's id to the per-type index. Idempotent: an update keeps its position. */
  private indexRecord(entityType: string, id: string): void {
    let ids = this.recordTypes.get(entityType);
    if (!ids) this.recordTypes.set(entityType, (ids = new Set()));
    ids.add(id);
  }

  /** The committed ids of `entityType` in committed order — what a typed scan walks. */
  typeIds(entityType: LocalEntityType): ReadonlySet<string> | undefined {
    return this.recordTypes.get(entityType);
  }

  /** Index a snapshot. The rows are adopted, not cloned: nothing mutates a committed row. */
  static from(initial?: Partial<LocalFirstSnapshot>): CommittedState {
    const state = new CommittedState();
    for (const record of initial?.records ?? []) {
      state.records.set(recordKey(record.entityType, record.id), record);
      state.indexRecord(record.entityType, record.id);
    }
    for (const event of initial?.events ?? []) state.events.set(event.eventId, event);
    // Legacy rows (no `syncId`, `kind:ref` in `serverId`) are read through the ONE normaliser; nothing is dropped.
    for (const raw of initial?.mappings ?? []) {
      const mapping = normalizeServerMapping(raw);
      state.mappings.set(mappingKey(mapping), mapping);
    }
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
      this.records.delete(recordKey(gone.entityType, gone.id));
      this.recordTypes.get(gone.entityType)?.delete(gone.id);
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
      this.records.set(recordKey(record.entityType, record.id), record);
      this.indexRecord(record.entityType, record.id);
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
      const mapping = normalizeServerMapping(raw);
      this.mappings.set(mappingKey(mapping), mapping);
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
    this.events.clear();
    this.mappings.clear();
    this.receipts.clear();
    this.conflicts.clear();
    this.cursors.clear();
    this.pendingKeys.clear();
    this.nextSequence = 1;
  }
}

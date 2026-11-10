/**
 * SECONDARY INDEXES over the committed rows: one entity type's rows grouped by a key
 * their payload carries (a message's chat), so a read of one group costs that group —
 * never a walk of every row of the type.
 *
 * An index is DECLARED by the module that owns the payload shape (`defineRecordIndex`, a
 * module-level constant: its object identity is the index) and BUILT lazily by the
 * committed state the first time a transaction reads through it (`scanIndex`). From then
 * on `CommittedState.applyDelta` — the one step every state change goes through (a
 * commit, another window's journal frame, a reload's `reset`) — keeps it current row by
 * row, so it can never drift from the rows it indexes. Nothing here is persisted: the
 * on-disk journal is unchanged, an index is rebuilt from the rows after every open.
 */

import type { LocalEntityType, LocalRecord } from './records.js';

/** What a row is grouped by. `undefined` from `keyOf`: the row is in no group. */
export type RecordIndexKey = string | number;

export interface RecordIndex<T = unknown> {
  readonly entityType: LocalEntityType;
  /** For diagnostics only — the index is the object, not the name. */
  readonly name: string;
  /** The row's group. Must be a pure function of the row: it is re-run on every upsert. */
  readonly keyOf: (row: Readonly<LocalRecord<T>>) => RecordIndexKey | undefined;
}

/** Declare an index ONCE, at module level: every read through the same object shares one built index. */
export function defineRecordIndex<T>(
  entityType: LocalEntityType,
  name: string,
  keyOf: (row: Readonly<LocalRecord<T>>) => RecordIndexKey | undefined,
): RecordIndex<T> {
  return Object.freeze({ entityType, name, keyOf });
}

/** A row's key, or undefined when `keyOf` cannot read it (a malformed payload is in no group). */
export function indexKeyOf(index: RecordIndex, row: Readonly<LocalRecord>): RecordIndexKey | undefined {
  try {
    return index.keyOf(row);
  } catch {
    return undefined;
  }
}

/**
 * One built index: groups of rows by key, each group in committed insertion order (an
 * update keeps its place, a row whose key changed moves to the end of its new group).
 * The rows are the committed state's own — never mutated here, never handed out mutable.
 */
export class RecordGroups {
  private readonly groups = new Map<RecordIndexKey, Map<string, LocalRecord>>();
  private readonly keyById = new Map<string, RecordIndexKey>();

  constructor(readonly index: RecordIndex) {}

  /** File (or re-file) one upserted row of the index's type. */
  put(record: LocalRecord): void {
    const key = indexKeyOf(this.index, record);
    const prior = this.keyById.get(record.id);
    if (prior !== undefined && prior !== key) this.detach(prior, record.id);
    if (key === undefined) {
      this.keyById.delete(record.id);
      return;
    }
    let group = this.groups.get(key);
    if (!group) this.groups.set(key, (group = new Map()));
    group.set(record.id, record);
    this.keyById.set(record.id, key);
  }

  /** Drop a deleted row. A row the index never filed is a no-op. */
  remove(id: string): void {
    const key = this.keyById.get(id);
    if (key === undefined) return;
    this.detach(key, id);
    this.keyById.delete(id);
  }

  /** The committed rows of one group, by id, in committed order. */
  group(key: RecordIndexKey): ReadonlyMap<string, LocalRecord> | undefined {
    return this.groups.get(key);
  }

  clear(): void {
    this.groups.clear();
    this.keyById.clear();
  }

  private detach(key: RecordIndexKey, id: string): void {
    const group = this.groups.get(key);
    if (!group) return;
    group.delete(id);
    if (group.size === 0) this.groups.delete(key);
  }
}

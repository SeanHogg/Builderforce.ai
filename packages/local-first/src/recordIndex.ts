/**
 * SECONDARY INDEXES over the committed rows: one entity type's LIVE rows grouped by a key
 * their payload carries (a message's chat), so a read of one group costs that group —
 * never a walk of every row of the type.
 *
 * An index is DECLARED by the module that owns the payload shape (`defineRecordIndex`, a
 * module-level constant) and BUILT lazily by the committed state the first time a
 * transaction reads through it (`scanIndex`). It is registered by `entityType:name`, so
 * two copies of the same declaration (a package's cjs and mjs builds each inline it) share
 * ONE built index; the same name with a different `keyOf` throws. From then on
 * `CommittedState.applyDelta` — the one step every state change goes through (a commit,
 * another window's journal frame, a reload's `reset`) — keeps it current row by row, so it
 * can never drift from the rows it indexes. Nothing here is persisted: the on-disk journal
 * is unchanged, an index is rebuilt from the rows after every open.
 *
 * CONTRACT for readers:
 *   - Groups hold LIVE rows only: a tombstone (`deletedAt`) is in no group.
 *   - Order within a group is UNSPECIFIED. It depends on history (a live index moves a row
 *     whose key changed to the end of its new group; a freshly built one uses type order),
 *     so a caller that needs an order sorts.
 *   - Visitors get the committed state's own rows, UNCLONED — never mutate or retain one;
 *     `selectByIndex` is the cloning form.
 *
 * Memory: per indexed row, one entry in its group's Map plus one in the id → key Map (two
 * Map entries, ~100–150 bytes), plus one Map per group — ~10 MB for a 75k-message store.
 */

import type { LocalEntityType, LocalRecord } from './records.js';

/** What a row is grouped by. `undefined` from `keyOf`: the row is in no group. */
export type RecordIndexKey = string | number;

export interface RecordIndex<T = unknown> {
  readonly entityType: LocalEntityType;
  /** The index's identity together with `entityType`: one name, one key function. */
  readonly name: string;
  /** The row's group. Must be a pure function of the row: it is re-run on every upsert. */
  readonly keyOf: (row: Readonly<LocalRecord<T>>) => RecordIndexKey | undefined;
}

/** Declare an index ONCE, at module level, under a name unique for its entity type. */
export function defineRecordIndex<T>(
  entityType: LocalEntityType,
  name: string,
  keyOf: (row: Readonly<LocalRecord<T>>) => RecordIndexKey | undefined,
): RecordIndex<T> {
  return Object.freeze({ entityType, name, keyOf });
}

/** Where an index is registered: `entityType:name`. */
export const recordIndexId = (index: RecordIndex): string => `${index.entityType}:${index.name}`;

/**
 * Whether `other` is the SAME index as `built` (registered under one id). The same object,
 * or the same declaration copied into another bundle — its `keyOf` has the same source.
 */
export function sameRecordIndex(built: RecordIndex, other: RecordIndex): boolean {
  return built === other || (built.entityType === other.entityType && built.name === other.name
    && (built.keyOf === other.keyOf || String(built.keyOf) === String(other.keyOf)));
}

/** A row's key: undefined for a tombstone, or when `keyOf` cannot read it (a malformed payload). */
export function indexKeyOf(index: RecordIndex, row: Readonly<LocalRecord>): RecordIndexKey | undefined {
  if (row.deletedAt) return undefined;
  try {
    return index.keyOf(row);
  } catch {
    return undefined;
  }
}

/**
 * One built index: groups of live rows by key (order within a group unspecified — see the
 * module contract). The rows are the committed state's own — never mutated here.
 */
export class RecordGroups {
  private readonly groups = new Map<RecordIndexKey, Map<string, LocalRecord>>();
  private readonly keyById = new Map<string, RecordIndexKey>();

  constructor(readonly index: RecordIndex) {}

  /** File (or re-file, or — for a tombstone — drop) one upserted row of the index's type. */
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

  /** The committed live rows of one group, by id. */
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

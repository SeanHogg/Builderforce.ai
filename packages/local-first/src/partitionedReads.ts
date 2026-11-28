/**
 * How a transaction reads a store with partitions (`recordPartition.ts`).
 *
 * Every read of a partitioned type first AWAITS the load of exactly the partitions it can
 * touch, then reads synchronously — so a scan can never see a partition half-installed.
 * A load is not a commit: it fills memory and notifies nobody, so it is allowed inside a
 * transaction and inside a lock-free read.
 *
 *   get(type, id)                     the row's partition (named by its stub)
 *   scanIndex(partition.index, home)  that one partition
 *   scanIndex(other) / scan / list    every partition of the type; order: by partition, then committed order
 *   put / delete                      the row's current partition (for `expectedVersion` and the deletion)
 *
 * Each function returns `undefined` when there is nothing to wait for, so a store with no
 * partitions — and a read of a partition already in memory — adds no turn of the event loop.
 */

import type { LocalEntityType, LocalRecord } from './records.js';
import type { CommittedState } from './storeState.js';
import type { DraftMap } from './draftMap.js';
import { SCAN_STOP, type ScanStop } from './storeContract.js';
import { indexKeyOf, sameRecordIndex, type RecordIndex, type RecordIndexKey } from './recordIndex.js';
import { homeOfRow, partitionIdOf, stubOf, type RecordStub } from './recordPartition.js';
import { recordKey } from './recordKey.js';

/** What a typed scan walks: the committed rows of a type by id, in order. */
export interface RowsView {
  keys(): Iterable<string>;
  values(): Iterable<LocalRecord>;
}

/** The committed rows of a type: the main rows, then each loaded partition's. A plain type is just its Map. */
export function typeRowsOf(state: CommittedState, entityType: LocalEntityType): RowsView | undefined {
  const main = state.typeRows(entityType);
  if (!state.table.concerns(entityType)) return main;
  const segments = state.table.segmentsOf(entityType);
  return {
    *keys() {
      if (main) yield* main.keys();
      for (const segment of segments) yield* segment.records.keys();
    },
    *values() {
      if (main) yield* main.values();
      for (const segment of segments) yield* segment.records.values();
    },
  };
}

export function loadRow(state: CommittedState, entityType: LocalEntityType, id: string): Promise<void> | undefined {
  const stub = state.table.stub(entityType, id);
  return stub ? state.table.load([partitionIdOf(entityType, stub.home)]) : undefined;
}

/** `scan(type)` reads every partition of the type; `scan(undefined)` reads every partition there is. */
export function loadType(state: CommittedState, entityType: LocalEntityType | undefined): Promise<void> | undefined {
  const table = state.table;
  if (!table.enabled) return undefined;
  if (entityType === undefined) return table.load(table.allPartitionIds());
  return table.concerns(entityType) ? table.load(table.partitionIdsOf(entityType)) : undefined;
}

const isOwnIndex = (state: CommittedState, index: RecordIndex): boolean => {
  const partition = state.table.partitionOf(index.entityType);
  return !!partition && sameRecordIndex(partition.index as RecordIndex, index);
};

/** The partition's own index reads ONE partition; any other index of the type reads them all. */
export function loadIndex(state: CommittedState, index: RecordIndex, key: RecordIndexKey): Promise<void> | undefined {
  const table = state.table;
  const type = index.entityType;
  if (!table.concerns(type)) return undefined;
  return table.load(isOwnIndex(state, index) ? [partitionIdOf(type, key)] : table.partitionIdsOf(type));
}

/**
 * The committed live rows of one index group, once its partitions are loaded. A tombstone is
 * in a partition (a home ignores `deletedAt`) but in no group, so each row is re-keyed through
 * the index here — which is also why an index other than the partition's own still answers right.
 */
export function committedGroup(state: CommittedState, index: RecordIndex, key: RecordIndexKey): ReadonlyMap<string, LocalRecord> | undefined {
  const table = state.table;
  const type = index.entityType;
  if (!table.concerns(type)) return state.indexGroup(index, key);
  const own = isOwnIndex(state, index);
  const group = new Map<string, LocalRecord>();
  // The main rows of the type are unpartitioned: no home, so (for the partition's own index) no group key.
  if (!own) for (const [id, row] of state.indexGroup(index, key) ?? []) group.set(id, row);
  const segments = own ? [table.segment(partitionIdOf(type, key))] : table.segmentsOf(type);
  for (const segment of segments) {
    for (const row of segment?.records.values() ?? []) {
      if (indexKeyOf(index, row) === key) group.set(row.id, row);
    }
  }
  return group.size > 0 ? group : undefined;
}

/** A row's stub under THIS build's partitions; undefined when the row is unpartitioned. */
export function rowStub(state: CommittedState, row: LocalRecord): RecordStub | undefined {
  const partition = state.table.partitionOf(row.entityType);
  return partition && stubOf(partition, row);
}

/** Whether writing `after` over `before` moves the row to another partition (or into / out of one). */
export function homeChanged(state: CommittedState, before: LocalRecord, after: LocalRecord): boolean {
  const partition = state.table.partitionOf(after.entityType);
  if (!partition) return false;
  const was = homeOfRow(partition, before);
  const now = homeOfRow(partition, after);
  return was === undefined || now === undefined ? was !== now : String(was) !== String(now);
}

/** One row's stub as the draft sees it: its own write or delete wins over the committed stub. */
export function draftStub(state: CommittedState, records: DraftMap<LocalRecord>, entityType: LocalEntityType, id: string): RecordStub | undefined {
  const change = records.peek(recordKey(entityType, id));
  if (!change) return state.table.stub(entityType, id);
  return change.deleted ? undefined : rowStub(state, change.value);
}

/** The committed stubs of a type, then the draft's new rows' — each as the draft sees it. Loads nothing. */
export function scanDraftStubs(
  state: CommittedState,
  records: DraftMap<LocalRecord>,
  entityType: LocalEntityType,
  visit: (stub: Readonly<RecordStub>) => void | ScanStop,
): void {
  const committed = state.table.stubsOf(entityType);
  for (const id of committed?.keys() ?? []) {
    const stub = draftStub(state, records, entityType, id);
    if (stub && visit(stub) === SCAN_STOP) return;
  }
  for (const [, row] of records.upserts()) {
    if (row.entityType !== entityType || committed?.has(row.id)) continue; // a committed row was visited above, in place
    const stub = rowStub(state, row);
    if (stub && visit(stub) === SCAN_STOP) return;
  }
}

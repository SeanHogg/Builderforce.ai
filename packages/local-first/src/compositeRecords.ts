/**
 * The committed rows of a store with partitions, as ONE read-only map: the main (unpartitioned)
 * rows, then every partition that is in memory. A transaction's draft overlays it
 * (`DraftMap`), so its reads and its `delta()` see a partitioned row exactly where a main row
 * would be, and a write needs no second code path.
 *
 * It reads only what is LOADED. A caller that needs a partition awaits its load first
 * (`partitionedReads.ts`), then reads synchronously — nothing here can wait.
 */

import type { LocalRecord } from './records.js';
import type { DraftBase } from './draftMap.js';
import type { PartitionTable } from './partitionTable.js';
import { partitionIdOf } from './recordPartition.js';
import { recordKey, splitRecordKey } from './recordKey.js';

export class CompositeRecords implements DraftBase<LocalRecord> {
  constructor(private readonly main: ReadonlyMap<string, LocalRecord>, private readonly table: PartitionTable) {}

  get(key: string): LocalRecord | undefined {
    const row = this.main.get(key);
    if (row) return row;
    const { entityType, id } = splitRecordKey(key);
    const stub = this.table.stub(entityType, id);
    return stub ? this.table.segment(partitionIdOf(entityType, stub.home))?.records.get(id) : undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Main rows in committed order, then each loaded partition's rows (partition by partition). */
  *values(): IterableIterator<LocalRecord> {
    yield* this.main.values();
    yield* this.table.loadedRows();
  }

  *[Symbol.iterator](): IterableIterator<[string, LocalRecord]> {
    yield* this.main;
    for (const row of this.table.loadedRows()) yield [recordKey(row.entityType, row.id), row];
  }
}

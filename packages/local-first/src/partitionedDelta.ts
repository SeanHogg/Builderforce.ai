/**
 * A commit's delta for a store with partitions.
 *
 * `Transaction.delta()` writes the partitioned rows into `records` / `deletedRecords` like any
 * other and ADDS the stubs that name them (`partitionedDeltaParts`). A host that stores each
 * partition apart splits that delta in two (`splitPartitionedDelta`): the stub changes stay in
 * the main frame with NO partitioned row, and each partition gets a frame of its own rows.
 */

import type { LocalEntityType, LocalRecord } from './records.js';
import type { CommittedState } from './storeState.js';
import type { LocalFirstDelta } from './localFirstDelta.js';
import { partitionIdOf, type PartitionDeclaration, type RecordStub } from './recordPartition.js';
import { rowStub } from './partitionedReads.js';
import { recordKey, splitRecordKey } from './recordKey.js';

type PartitionedDeltaParts = Pick<LocalFirstDelta, 'stubs' | 'deletedStubs' | 'partitionDeclarations'>;

/**
 * What a draft's writes add to its delta for the partitioned types: a stub per partitioned row
 * upserted, the home each removed row LIVED in (a deletion names its partition by it), and the
 * declarations the journal has not persisted yet. Empty for a store with no partitions.
 */
export function partitionedDeltaParts(state: CommittedState, upserts: readonly LocalRecord[], removedKeys: readonly string[]): PartitionedDeltaParts {
  const table = state.table;
  if (!table.enabled) return {};
  const stubs: RecordStub[] = [];
  for (const row of upserts) {
    const stub = rowStub(state, row);
    if (stub) stubs.push(stub);
  }
  const deletedStubs: NonNullable<LocalFirstDelta['deletedStubs']> = [];
  for (const key of removedKeys) {
    const { entityType, id } = splitRecordKey(key);
    const stub = table.stub(entityType, id);
    if (stub) deletedStubs.push({ entityType, id, home: stub.home });
  }
  const declarations = table.missingDeclarations([...stubs, ...deletedStubs].map((stub) => stub.entityType));
  return {
    ...(stubs.length > 0 ? { stubs } : {}),
    ...(deletedStubs.length > 0 ? { deletedStubs } : {}),
    ...(declarations.length > 0 ? { partitionDeclarations: declarations } : {}),
  };
}

/**
 * Split a commit into the MAIN part and one part per partition (by partition id).
 *
 * `main` is the delta with every partitioned row and partitioned deletion taken out — it keeps
 * the stub changes, events, mappings and everything else — so the main journal never holds a
 * message. A partition's part carries only its rows (`records`, `deletedRecords`). A row that
 * changed home appears as a deletion in the old partition's part and an upsert in the new one's.
 * A deletion of a partitioned type with no `deletedStubs` entry names a row of the main state
 * (an unpartitioned row) and stays in `main`. Pointers are the host's to add: it knows where
 * it appended.
 */
export function splitPartitionedDelta(
  delta: LocalFirstDelta,
  declarations: readonly Pick<PartitionDeclaration, 'entityType'>[],
): { main: LocalFirstDelta; partitions: Map<string, LocalFirstDelta> } {
  const types = new Set<LocalEntityType>(declarations.map((declaration) => declaration.entityType));
  const partitions = new Map<string, LocalFirstDelta>();
  const partOf = (id: string): LocalFirstDelta => {
    let part = partitions.get(id);
    if (!part) partitions.set(id, (part = {}));
    return part;
  };
  const homes = new Map<string, RecordStub['home']>();
  for (const stub of delta.stubs ?? []) homes.set(recordKey(stub.entityType, stub.id), stub.home);
  const goneHomes = new Map<string, RecordStub['home']>();
  for (const gone of delta.deletedStubs ?? []) goneHomes.set(recordKey(gone.entityType, gone.id), gone.home);

  const records: LocalRecord[] = [];
  for (const row of delta.records ?? []) {
    if (!types.has(row.entityType)) {
      records.push(row);
      continue;
    }
    const home = homes.get(recordKey(row.entityType, row.id));
    if (home === undefined) {
      records.push(row); // no home, so no stub: an unpartitioned row (a message with no chat) lives in main
      continue;
    }
    (partOf(partitionIdOf(row.entityType, home)).records ??= []).push(row);
  }
  const deletedRecords: NonNullable<LocalFirstDelta['deletedRecords']> = [];
  for (const gone of delta.deletedRecords ?? []) {
    const home = types.has(gone.entityType) ? goneHomes.get(recordKey(gone.entityType, gone.id)) : undefined;
    if (home === undefined) deletedRecords.push(gone);
    else (partOf(partitionIdOf(gone.entityType, home)).deletedRecords ??= []).push(gone);
  }

  const { records: _records, deletedRecords: _deleted, ...rest } = delta;
  const main: LocalFirstDelta = {
    ...rest,
    ...(records.length > 0 ? { records } : {}),
    ...(deletedRecords.length > 0 ? { deletedRecords } : {}),
  };
  return { main, partitions };
}

/**
 * RECORD PARTITIONS: where a row LIVES, for entity types whose rows are too many to read at
 * open. A partitioned type's rows are grouped by a "home" (a message's chat); a host stores
 * each group apart and the store reads a group only when a read can touch it. What stays in
 * memory for every row is a STUB — the few fields the hot paths read without the row.
 *
 * A home is NOT an index group key. An index drops a tombstone (`indexKeyOf` returns
 * undefined for `deletedAt`); a home does not, so a tombstoned message stays in its chat's
 * partition and a delete never moves bytes between files. `homeOf` is therefore the index's
 * `keyOf` ignoring `deletedAt`; `undefined` means the row is unpartitioned and lives in the
 * main state exactly as it does for a store with no partitions.
 *
 * This file is the vocabulary (declaration, stub, pointer, loader port, partition id). The
 * state is `partitionTable.ts`; the routing of reads is `partitionedReads.ts`.
 */

import { destinationKey, type LocalEntityType, type LocalRecord } from './records.js';
import type { LocalFirstDelta } from './localFirstDelta.js';
import type { RecordIndex, RecordIndexKey } from './recordIndex.js';

export interface RecordPartition<T = unknown> {
  /** Its groups ARE the partitions: `scanIndex(partition.index, home)` reads exactly one partition. */
  readonly index: RecordIndex<T>;
  /** The row's partition key — the index's `keyOf` ignoring `deletedAt`. `undefined`: unpartitioned. */
  readonly homeOf: (row: Readonly<LocalRecord<T>>) => RecordIndexKey | undefined;
  /** A number the stub carries for the row (a message's per-chat id), so a caller reads it without the row. */
  readonly ordinalOf?: (row: Readonly<LocalRecord<T>>) => number | undefined;
}

/**
 * A partition of ANY payload type, for a list of them (store options). Its functions take a
 * row as a parameter, so `never` is the one payload type every `RecordPartition<T>` is
 * assignable to; the store casts back to `RecordPartition` where it calls them.
 */
export type AnyRecordPartition = RecordPartition<never>;

/** Declare a partition ONCE, at module level, beside the index it partitions by. */
export function defineRecordPartition<T>(partition: RecordPartition<T>): RecordPartition<T> {
  return Object.freeze({ ...partition });
}

/** What the committed state keeps of a partitioned row (tombstones included) while its partition is unloaded. */
export interface RecordStub {
  id: string;
  entityType: LocalEntityType;
  home: RecordIndexKey;
  version: number;
  deleted: boolean;
  /** `provenance.deviceId` and `provenance.source`: what `isOwnRecord` reads. */
  deviceId: string;
  source: string;
  destinationKey: string;
  unbound: boolean;
  ordinal?: number;
}

/**
 * Where a partition's rows are stored and how far the committed state counts them. OPAQUE to
 * this package: the host mints it (a file and its committed length) and hands it back to its
 * own `PartitionLoader`; the package only compares pointers and moves them with the commit.
 */
export interface PartitionPointer {
  file: string;
  length: number;
  generation?: string;
}

/** What a journal persists about a partitioned type, so a build that declares differently still finds the rows. */
export interface PartitionDeclaration {
  entityType: LocalEntityType;
  index: string;
}

/**
 * The host's reader of one partition. Returns the partition's ROWS only (`records`,
 * `deletedRecords`) as of `pointer`. With `from` it returns just what was appended after that
 * position of the same file; without, the whole partition. A load is a read: it never commits.
 * It MUST REJECT on any failure it cannot fully recover from: the table installs only what a
 * load resolved with, so an empty result would be read as "this partition has no rows".
 */
export interface PartitionLoader {
  load(partitionId: string, pointer: PartitionPointer, from?: { file: string; length: number }): Promise<LocalFirstDelta>;
}

/** THE partition id: the host names files by it and the table keys segments and pointers by it. */
export const partitionIdOf = (entityType: LocalEntityType, home: RecordIndexKey): string => `${entityType}\u0000${String(home)}`;

/** The entity type a partition id names (the inverse of `partitionIdOf`'s first half). */
export const partitionTypeOf = (partitionId: string): LocalEntityType =>
  partitionId.slice(0, partitionId.indexOf('\u0000')) as LocalEntityType;

export const partitionDeclarationOf = (partition: AnyRecordPartition): PartitionDeclaration =>
  ({ entityType: partition.index.entityType, index: partition.index.name });

/** A row's home: undefined when the row is unpartitioned. Throws when `homeOf` cannot read the row. */
export function homeOfRow<T>(partition: RecordPartition<T>, row: Readonly<LocalRecord<T>>): RecordIndexKey | undefined {
  return partition.homeOf(row);
}

/**
 * The ONE stub builder. `undefined` when the row is unpartitioned. A `homeOf` or `ordinalOf`
 * that throws THROWS out of here, so a write of a row they cannot read fails visibly: filing it
 * in main would hide it from every stub reader, and a stub without its ordinal would let
 * `nextId` re-issue that id.
 */
export function stubOf<T>(partition: RecordPartition<T>, row: Readonly<LocalRecord<T>>): RecordStub | undefined {
  const home = homeOfRow(partition, row);
  if (home === undefined) return undefined;
  const ordinal = partition.ordinalOf?.(row);
  return {
    id: row.id,
    entityType: row.entityType,
    home,
    version: row.version,
    deleted: !!row.deletedAt,
    deviceId: row.provenance?.deviceId ?? '',
    // An absent provenance reads as a local row, exactly as `isOwnRecord` treats it.
    source: row.provenance?.source ?? 'local',
    destinationKey: destinationKey(row.destination),
    unbound: row.destination.kind === 'unbound',
    ...(ordinal !== undefined ? { ordinal } : {}),
  };
}

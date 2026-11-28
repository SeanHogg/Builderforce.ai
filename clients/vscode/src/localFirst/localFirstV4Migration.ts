/**
 * v3 -> v4 (AE-G031): cut a partitioned store out of `local-first-v3.journal`, in two phases like a
 * compaction, so neither holds the cross-window lock longer than one does (other windows, old builds
 * included, never meet `local_first_store_busy`).
 *
 *   1. WITHOUT the lock: fold v3 at offset X. Run the event-backlog migration on that resident fold and
 *      set `EVENT_BACKLOG_MIGRATED` unconditionally (so it never runs again). Stream every partition and
 *      the v4 base into temps (`partitionizeSnapshot`).
 *   2. UNDER the lock: when no other window got there first, rename the temps in (the main journal last:
 *      it is the commit point) and record the v3 baseline (length X and generation). What an old window
 *      appended to v3 after X is merged right after, by the open's `mergeLegacyWrites` seam
 *      (`localFirstV4Merge.ts`) — one v4 commit, planned with lookups.
 *
 * `partitionizeSnapshot` is also what an import or a rebuild uses when its source still holds message rows.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  EVENT_BACKLOG_MIGRATED,
  mintJournalGeneration,
  partitionDeclarationOf,
  partitionIdOf,
  planEventBacklogMigration,
  snapshotFrames,
  stubOf,
  type AnyRecordPartition,
  type LocalFirstSnapshot,
  type LocalRecord,
  type RecordPartition,
  type RecordStub,
} from "@builderforce/local-first";
import { renameDurably, temporaryPathFor, writeFrameFile } from "./localFirstAtomicFile";
import type { LocalFirstFileLock } from "./localFirstLock";
import { createNodeJournalIo, yieldToEventLoop } from "./localFirstJournalIo";
import { fsyncDirectory, removeUnreferencedPartitions } from "./localFirstPartitionFiles";
import {
  PARTITIONS_DIR,
  V4_JOURNAL_FILE,
  partitionFileName,
  partitionRelativePath,
  partitionTempName,
  type VsixPartitionPointer,
} from "./localFirstPartitionNames";
import { writeV3Baseline } from "./localFirstV4Merge";

const fs = nodeFs.promises;

/** A snapshot split into its main part and the partition files that hold the rest, written as temps. */
export interface PartitionizedBase {
  /** Unpartitioned rows, mappings, events… plus every stub, pointer and declaration. */
  main: LocalFirstSnapshot;
  partitions: number;
  /** Rename the temps to their final names (the lock holder only). */
  publish(): Promise<void>;
  /** Remove the temps. */
  discard(): Promise<void>;
}

const emptyRows = (records: LocalRecord[]): LocalFirstSnapshot =>
  ({ records, events: [], mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence: 1 });

/** Group the rows of every partitioned type by home and stream each group into its own temp file. */
export async function partitionizeSnapshot(
  directory: string,
  declared: readonly AnyRecordPartition[],
  snapshot: LocalFirstSnapshot,
): Promise<PartitionizedBase> {
  const types = new Map(declared.map((partition) => [partition.index.entityType, partition as RecordPartition]));
  const main: LocalRecord[] = [];
  const stubs: RecordStub[] = [...(snapshot.stubs ?? [])];
  const byId = new Map<string, { type: LocalRecord["entityType"]; home: RecordStub["home"]; rows: LocalRecord[] }>();
  for (const row of snapshot.records) {
    const partition = types.get(row.entityType);
    const stub = partition && stubOf(partition, row);
    if (!stub) {
      main.push(row);
      continue;
    }
    stubs.push(stub);
    const id = partitionIdOf(stub.entityType, stub.home);
    let group = byId.get(id);
    if (!group) byId.set(id, (group = { type: stub.entityType, home: stub.home, rows: [] }));
    group.rows.push(row);
  }
  await fs.mkdir(nodePath.join(directory, PARTITIONS_DIR), { recursive: true });
  const pointers: Record<string, VsixPartitionPointer> = { ...(snapshot.partitionPointers as Record<string, VsixPartitionPointer> | undefined) };
  const moves: Array<{ temporary: string; final: string }> = [];
  try {
    for (const [id, group] of byId) {
      const generation = mintJournalGeneration();
      const name = partitionFileName(group.type, group.home, generation);
      const final = nodePath.join(directory, partitionRelativePath(name));
      const temporary = nodePath.join(directory, partitionRelativePath(partitionTempName(name, generation)));
      const written = await writeFrameFile(temporary, snapshotFrames(emptyRows(group.rows), yieldToEventLoop, undefined, generation));
      moves.push({ temporary, final });
      pointers[id] = { file: partitionRelativePath(name), length: written.bytes, generation, commitSeq: 0, base: written.bytes, tailFrames: 0 };
    }
  } catch (error) {
    await Promise.all(moves.map((move) => fs.rm(move.temporary, { force: true })));
    throw error;
  }
  const declarations = [...(snapshot.partitionDeclarations ?? [])];
  for (const partition of types.values()) {
    if (stubs.some((stub) => stub.entityType === partition.index.entityType) && !declarations.some((d) => d.entityType === partition.index.entityType)) {
      declarations.push(partitionDeclarationOf(partition));
    }
  }
  return {
    main: {
      ...snapshot,
      records: main,
      ...(stubs.length > 0 ? { stubs } : {}),
      ...(Object.keys(pointers).length > 0 ? { partitionPointers: pointers } : {}),
      ...(declarations.length > 0 ? { partitionDeclarations: declarations } : {}),
    },
    partitions: byId.size,
    async publish() {
      for (const move of moves) await renameDurably(move.temporary, move.final);
      await fsyncDirectory(nodePath.join(directory, PARTITIONS_DIR));
    },
    async discard() {
      await Promise.all(moves.map((move) => fs.rm(move.temporary, { force: true }).catch(() => undefined)));
    },
  };
}

/**
 * The event-backlog migration applied to a RESIDENT snapshot (the plan's own deltas, in order), with the
 * one-time flag set whether or not anything needed migrating — the migration must never run again on v4,
 * where `view().records` holds no message row.
 */
export function withBacklogMigrated(snapshot: LocalFirstSnapshot, at: string, plan: boolean = true): LocalFirstSnapshot {
  const { deltas } = plan ? planEventBacklogMigration(snapshot, { at }) : { deltas: [] };
  const events = new Map(snapshot.events.map((event) => [event.eventId, event]));
  let nextSequence = snapshot.nextSequence;
  let cursors: Record<string, string> = { ...snapshot.cursors };
  for (const delta of deltas) {
    for (const id of delta.acknowledgedEvents ?? []) events.delete(id);
    for (const event of delta.events ?? []) events.set(event.eventId, event);
    if (delta.nextSequence !== undefined) nextSequence = delta.nextSequence;
    cursors = { ...cursors, ...delta.cursors };
  }
  if (cursors[EVENT_BACKLOG_MIGRATED] === undefined) cursors[EVENT_BACKLOG_MIGRATED] = at;
  return { ...snapshot, events: [...events.values()], cursors, nextSequence };
}

export interface V3ToV4Ports {
  directory: string;
  partitions: readonly AnyRecordPartition[];
  lock: LocalFirstFileLock;
  openWaitMs: number;
  onBackgroundError(error: unknown): void;
}

const hasContent = async (path: string): Promise<boolean> => {
  try {
    return (await fs.stat(path)).size > 0;
  } catch {
    return false;
  }
};

/** Cut v4 out of v3. Returns whether v4 now exists because of this call (false: nothing to migrate, or another window did it). */
export async function migrateV3ToV4(ports: V3ToV4Ports): Promise<boolean> {
  const { directory } = ports;
  const v4File = nodePath.join(directory, V4_JOURNAL_FILE);
  const startedAt = new Date().toISOString(); // taken BEFORE the fold: a v3 row written later carries a later `updatedAt`
  const v3 = await createNodeJournalIo(directory).load(yieldToEventLoop);
  const folded = v3.corrupt && !v3.baseClosed ? undefined : v3.latest;
  if (!folded) return false;
  if (v3.corrupt) ports.onBackgroundError(new Error(`local-first: v3 journal is damaged (${v3.corrupt}); v4 was cut from its sound prefix`));

  const base = await partitionizeSnapshot(directory, ports.partitions, withBacklogMigrated(folded, startedAt));
  const temporary = temporaryPathFor(v4File);
  try {
    await writeFrameFile(temporary, snapshotFrames(base.main, yieldToEventLoop, undefined, mintJournalGeneration()));
    await ports.lock.acquire(ports.openWaitMs);
    try {
      if (await hasContent(v4File)) {
        await base.discard();
        await fs.rm(temporary, { force: true });
        return false;
      }
      // Nothing names a partition file yet: whatever is there is a leftover of an earlier attempt.
      await removeUnreferencedPartitions(directory, new Set(Object.values(base.main.partitionPointers ?? {}).map((pointer) => pointer.file)));
      await writeV3Baseline(directory, { v3Length: v3.committedBytes, v3Generation: v3.identity?.generation, migratedAt: startedAt });
      await base.publish();
      await renameDurably(temporary, v4File); // the commit point of the migration
      return true;
    } finally {
      await ports.lock.release();
    }
  } catch (error) {
    await base.discard();
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Partition compaction (AE-G031): a partition folds its own tail on its own policy, in two phases like
 * the main journal's (`localFirstCompaction.ts`, whose tail copy this reuses):
 *
 *   1. WITHOUT the lock: fold the partition file as it stood at its pointer and stream the rows into a
 *      temp named `*.tmp-<generation>`, fsynced.
 *   2. UNDER the lock (caught up with main): when the partition's pointer still names the same generation,
 *      copy the frames committed since onto the temp, fsync, rename it to the new generation's name, and
 *      commit a main frame that switches the pointer. Anything else discards the temp.
 *
 * Old generations are deleted afterwards, under the lock, only when no pointer names them
 * (`removeUnreferencedPartitions`); a reader still on one gets ENOENT and retries
 * (`localFirstPartitionLoader.ts`).
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  mintJournalGeneration,
  partitionTypeOf,
  shouldCompactJournal,
  snapshotFrames,
  type JournalCompactionPolicy,
  type LocalFirstDelta,
} from "@builderforce/local-first";
import { renameDurably, writeFrameFile } from "./localFirstAtomicFile";
import { copyCommittedTail } from "./localFirstCompaction";
import { yieldToEventLoop } from "./localFirstJournalIo";
import { foldPartitionFile, PartitionDamagedError, PartitionMissingError, removeUnreferencedPartitions } from "./localFirstPartitionFiles";
import { partitionFileName, partitionRelativePath, partitionTempName, type VsixPartitionPointer } from "./localFirstPartitionNames";
import type { PointerTracker } from "./localFirstPartitionCommit";

const fs = nodeFs.promises;

/** A partition's tail is measured like the main journal's, against thresholds sized for one chat. */
export const DEFAULT_PARTITION_COMPACTION: JournalCompactionPolicy = Object.freeze({ maxFrames: 2048, maxBytes: 32 * 1024 * 1024 });

export interface PartitionCompactionPorts {
  directory: string;
  pointers: PointerTracker;
  policy?: Partial<JournalCompactionPolicy>;
  /** Run `work` as the lock holder, with memory caught up with the main journal. */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** Append one main frame and apply it (under the lock). */
  commitMain(delta: LocalFirstDelta): Promise<void>;
  onDamaged(partitionId: string, pointer: VsixPartitionPointer, reason: string): void;
}

export interface PartitionCompactor {
  /** The partitions whose tail is past the policy. */
  due(): string[];
  /** Compact one. Returns whether a new generation was published. */
  compact(partitionId: string): Promise<boolean>;
}

export function createPartitionCompactor(ports: PartitionCompactionPorts): PartitionCompactor {
  const policy = { ...DEFAULT_PARTITION_COMPACTION, ...ports.policy };
  const tailOf = (pointer: VsixPartitionPointer): { frames: number; bytes: number } =>
    ({ frames: pointer.tailFrames, bytes: pointer.length - pointer.base });

  return {
    due() {
      const ids: string[] = [];
      for (const [id, pointer] of ports.pointers.entries()) if (shouldCompactJournal(tailOf(pointer), policy)) ids.push(id);
      return ids;
    },

    async compact(partitionId) {
      const before = ports.pointers.get(partitionId);
      if (!before || !shouldCompactJournal(tailOf(before), policy)) return false;
      let folded: Awaited<ReturnType<typeof foldPartitionFile>>;
      try {
        folded = await foldPartitionFile(nodePath.join(ports.directory, before.file), before.length);
      } catch (error) {
        // Gone because another window compacted it, or really damaged: the loader tells those apart on the next read.
        if (error instanceof PartitionDamagedError) ports.onDamaged(partitionId, before, error.message);
        else if (!(error instanceof PartitionMissingError)) throw error;
        return false;
      }
      const generation = mintJournalGeneration();
      const finalName = partitionFileName(partitionTypeOf(partitionId), partitionId.slice(partitionId.indexOf("\u0000") + 1), generation);
      const finalPath = nodePath.join(ports.directory, partitionRelativePath(finalName));
      const temporary = nodePath.join(ports.directory, partitionRelativePath(partitionTempName(finalName, generation)));
      const written = await writeFrameFile(temporary, snapshotFrames(folded ?? emptySnapshot(), yieldToEventLoop, undefined, generation));
      try {
        return await ports.exclusive(async () => {
          const now = ports.pointers.get(partitionId);
          if (!now || now.file !== before.file || now.generation !== before.generation || now.length < before.length) {
            await fs.rm(temporary, { force: true });
            return false;
          }
          const handle = await fs.open(temporary, "r+");
          let copied: { frames: number; bytes: number };
          try {
            copied = await copyCommittedTail(nodePath.join(ports.directory, now.file), before.length, now.length, handle, written.bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await renameDurably(temporary, finalPath);
          const next: VsixPartitionPointer = {
            file: partitionRelativePath(finalName),
            length: written.bytes + copied.bytes,
            generation,
            commitSeq: now.commitSeq,
            base: written.bytes,
            tailFrames: copied.frames,
          };
          await ports.commitMain({ partitionPointers: { [partitionId]: next } });
          await removeUnreferencedPartitions(ports.directory, ports.pointers.files());
          return true;
        });
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    },
  };
}

const emptySnapshot = () => ({ records: [], events: [], mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence: 1 });

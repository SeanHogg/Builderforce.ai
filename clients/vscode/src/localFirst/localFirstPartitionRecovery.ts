/**
 * A damaged partition (AE-G031 "Recovery"): its file is not what its pointer says (frames that do not
 * parse, bytes missing, the file gone for good — NOT a lock that has not passed: EPERM, EBUSY and EACCES are
 * reported and retried by the next read). It never fails an open: the loader rejects that one read (installing
 * nothing) and queues this job on the store's own serial queue, which, under the lock:
 *
 *   1. sets the file aside (`<file>.corrupt-<time>`, never deleted),
 *   2. commits stub deletions for the partition's rows plus a pointer to a fresh, empty generation, so no
 *      stub is left naming a row that is gone and no later read meets the bad file again,
 *   3. resets the pull cursor of every BOUND destination those rows belonged to, so the next pull refills
 *      them from the server,
 *   4. REPORTS what was lost (`onBackgroundError`) — a catch reports, it never just skips.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import { mintJournalGeneration, partitionIdOf, partitionTypeOf, type LocalFirstDelta, type LocalFirstSnapshot } from "@builderforce/local-first";
import { fsyncDirectory, foldPartitionFile, PartitionDamagedError, PartitionMissingError } from "./localFirstPartitionFiles";
import { partitionFileName, partitionRelativePath, type VsixPartitionPointer } from "./localFirstPartitionNames";
import type { PointerTracker } from "./localFirstPartitionCommit";

const fs = nodeFs.promises;

export interface PartitionRecoveryPorts {
  directory: string;
  pointers: PointerTracker;
  /** Drop these partitions' loaded segments: the next read loads them in full (`MemoryLocalFirstStore.evictPartitions`). */
  evict(partitionIds: readonly string[]): void;
  /** The committed state (stubs included). */
  view(): LocalFirstSnapshot;
  serialized<T>(work: () => Promise<T>): Promise<T>;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** Append one main frame and apply it (under the lock). */
  commitMain(delta: LocalFirstDelta): Promise<void>;
  onBackgroundError(error: unknown): void;
}

/** Queue the recovery of one partition. Safe to call again for the same damage: one job runs. */
export type OnPartitionDamaged = (partitionId: string, pointer: VsixPartitionPointer, reason: string) => void;

export function createPartitionRecovery(ports: PartitionRecoveryPorts): OnPartitionDamaged {
  const queued = new Set<string>();

  const recover = async (partitionId: string, pointer: VsixPartitionPointer, reason: string): Promise<void> => {
    const now = ports.pointers.get(partitionId);
    if (!now || now.file !== pointer.file || now.generation !== pointer.generation) return; // the pointer moved: not damage any more
    const path = nodePath.join(ports.directory, now.file);
    try {
      await foldPartitionFile(path, now.length);
      ports.evict([partitionId]); // readable now: it was transient; whatever a failed read left is dropped, the next read loads in full
      return;
    } catch (error) {
      // Damage is a file that does not parse, or one that is GONE. A lock (EPERM, EBUSY, EACCES) is neither:
      // it is reported (the queue's catch) and the partition is left alone.
      const damage = error instanceof PartitionDamagedError || (error instanceof PartitionMissingError && error.gone);
      if (!damage) throw error;
    }
    let setAside = "(the file was already gone)";
    try {
      setAside = `${path}.corrupt-${Date.now()}`;
      await fs.rename(path, setAside);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      setAside = "(the file was already gone)";
    }
    const lost = (ports.view().stubs ?? []).filter((stub) => partitionIdOf(stub.entityType, stub.home) === partitionId);
    const generation = mintJournalGeneration();
    const file = partitionRelativePath(partitionFileName(partitionTypeOf(partitionId), partitionId.slice(partitionId.indexOf("\u0000") + 1), generation));
    const fresh = nodePath.join(ports.directory, file);
    await fs.mkdir(nodePath.dirname(fresh), { recursive: true });
    const handle = await fs.open(fresh, "wx");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsyncDirectory(nodePath.dirname(fresh));
    const destinations = [...new Set(lost.filter((stub) => !stub.unbound).map((stub) => stub.destinationKey))];
    const next: VsixPartitionPointer = { file, length: 0, generation, commitSeq: now.commitSeq, base: 0, tailFrames: 0 };
    await ports.commitMain({
      ...(lost.length > 0 ? { deletedStubs: lost.map((stub) => ({ entityType: stub.entityType, id: stub.id, home: stub.home })) } : {}),
      ...(destinations.length > 0 ? { unsetCursors: destinations } : {}),
      partitionPointers: { [partitionId]: next },
    });
    ports.onBackgroundError(new Error(
      `local-first: partition ${partitionId.replace("\u0000", "/")} is damaged (${reason}); set aside at ${setAside}; `
      + `${lost.length} rows dropped${destinations.length > 0 ? `, pull cursor reset for ${destinations.join(", ")}` : ""}`,
    ));
  };

  return (partitionId, pointer, reason) => {
    const key = `${partitionId}|${pointer.file}`;
    if (queued.has(key)) return;
    queued.add(key);
    void ports.serialized(() => ports.exclusive(() => recover(partitionId, pointer, reason)))
      .catch(ports.onBackgroundError)
      .finally(() => queued.delete(key));
  };
}

/**
 * The `PartitionLoader` of the VSIX store (AE-G031): reads a partition's rows up to its pointer.
 *
 * A load that fails REJECTS and installs nothing — it never returns an empty read for a partition that has
 * rows (an empty chat in memory would make sync acknowledge its pending events as gone).
 *
 * A read can race a compaction (another window renamed a new generation in and deleted the old one) or a
 * scanner holding the file. Neither is damage:
 *   - ENOENT: refresh the main journal. When the pointer moved, read the NEW pointer instead (whole: the file
 *     is another generation). When it did not move, retry a few times, then — the pointer being confirmed
 *     current — the file is lost: damage.
 *   - EPERM / EBUSY / EACCES: a lock that will pass. Retried a few times, then the read rejects. Never damage.
 * Damage (a file whose frames do not parse, or a lost file) is handed to `onDamaged`, which queues the
 * recovery on the store's own queue (a load may be running inside a transaction, so it never waits for it),
 * and the read rejects.
 */

import nodePath from "node:path";
import type { PartitionLoader, PartitionPointer } from "@builderforce/local-first";
import { sleep } from "../shared/sleep";
import { loadPartition, PartitionDamagedError, PartitionMissingError } from "./localFirstPartitionFiles";
import { asVsixPointer, type VsixPartitionPointer } from "./localFirstPartitionNames";

const RETRIES = 3;
const RETRY_PAUSE_MS = 25;

export interface PartitionLoaderPorts {
  directory: string;
  /** The pointer the state holds now (kept current by the main tail). */
  pointerOf(partitionId: string): VsixPartitionPointer | undefined;
  /** Catch up with the main journal. During the open (which holds the lock, caught up) this is a no-op. */
  refreshMain(): Promise<void>;
  onDamaged(partitionId: string, pointer: VsixPartitionPointer, reason: string): void;
  onBackgroundError(error: unknown): void;
}

const samePlace = (a: PartitionPointer, b: PartitionPointer): boolean =>
  a.file === b.file && a.generation === b.generation && a.length === b.length;

export function createPartitionLoader(ports: PartitionLoaderPorts): PartitionLoader {
  const load: PartitionLoader["load"] = async (partitionId, pointer, from) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await loadPartition(nodePath.join(ports.directory, pointer.file), pointer, from);
      } catch (error) {
        if (error instanceof PartitionDamagedError) {
          ports.onDamaged(partitionId, asVsixPointer(pointer), error.message);
          throw error;
        }
        if (!(error instanceof PartitionMissingError)) throw error;
        // Another window may have moved the pointer (compacted and deleted this generation): look again.
        await ports.refreshMain().catch(ports.onBackgroundError);
        const now = ports.pointerOf(partitionId);
        if (now && !samePlace(now, pointer)) return load(partitionId, now); // the new generation, whole
        if (attempt < RETRIES) {
          await sleep(RETRY_PAUSE_MS * (attempt + 1));
          continue;
        }
        if (error.gone) ports.onDamaged(partitionId, asVsixPointer(pointer), error.message); // ENOENT against a current pointer
        else ports.onBackgroundError(error); // a lock that did not pass: reported, retried by the next read
        throw error;
      }
    }
  };
  return { load };
}

/**
 * The `PartitionLoader` of the VSIX store (AE-G031): reads a partition's rows up to its pointer.
 *
 * A read can race a compaction (another window renamed a new generation in and deleted the old one) or a
 * scanner holding the file. That is never damage: the loader refreshes the main journal, which moves the
 * pointer, and gives the state an empty read for the pointer it asked for — the state sees its pointer moved
 * and reads again (`PartitionTable.readUntilCurrent`). Only a file that stays missing or unreadable against an
 * UNMOVED pointer, or one whose frames do not parse, is damage; it is handed to `onDamaged` (which queues the
 * recovery on the store's own queue — a load may be running inside a transaction, so it never waits for it)
 * and the read proceeds with no rows, so a damaged chat never fails the open or the read.
 */

import nodePath from "node:path";
import type { PartitionLoader, PartitionPointer } from "@builderforce/local-first";
import { sleep } from "../shared/sleep";
import { loadPartition, PartitionDamagedError, PartitionMissingError } from "./localFirstPartitionFiles";
import { asVsixPointer, type VsixPartitionPointer } from "./localFirstPartitionNames";

/** Looks at the main journal again (another window's tail) before the loader gives a missing file up. */
const RETRIES = 3;
const RETRY_PAUSE_MS = 25;

export interface PartitionLoaderPorts {
  directory: string;
  /** The pointer the state holds now (kept current by the main tail). */
  pointerOf(partitionId: string): VsixPartitionPointer | undefined;
  /** Catch up with the main journal. During the open (which holds the lock, caught up) this is a no-op. */
  refreshMain(): Promise<void>;
  onDamaged(partitionId: string, pointer: VsixPartitionPointer, reason: string): void;
}

const samePlace = (a: PartitionPointer, b: PartitionPointer): boolean =>
  a.file === b.file && a.generation === b.generation && a.length === b.length;

export function createPartitionLoader(ports: PartitionLoaderPorts): PartitionLoader {
  return {
    async load(partitionId, pointer, from) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await loadPartition(nodePath.join(ports.directory, pointer.file), pointer, from);
        } catch (error) {
          if (error instanceof PartitionDamagedError) {
            ports.onDamaged(partitionId, asVsixPointer(pointer), error.message);
            return {};
          }
          if (!(error instanceof PartitionMissingError)) throw error;
          await ports.refreshMain().catch(() => undefined);
          const now = ports.pointerOf(partitionId);
          if (!now || !samePlace(now, pointer)) return {}; // moved: the state reads against the new pointer
          if (attempt < RETRIES) {
            await sleep(RETRY_PAUSE_MS * (attempt + 1));
            continue;
          }
          ports.onDamaged(partitionId, asVsixPointer(pointer), error.message);
          return {};
        }
      }
    },
  };
}

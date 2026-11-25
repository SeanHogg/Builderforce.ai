/**
 * The durable store's open-time rebuilds (G03): the one-time v2 import and the damaged-v3
 * rebuild, both UNDER the cross-window lock. Split from `durableLocalFirstStore.ts`, which
 * supplies the ports (its io, lock and memory); the behaviour is unchanged. No `vscode` import.
 */

import nodeFs from "node:fs";
import { EMPTY_LOCAL_FIRST_SNAPSHOT, type LocalFirstSnapshot } from "@builderforce/local-first";
import type { LocalFirstFileLock } from "./localFirstLock";
import { LocalFirstStoreCorruptError, quarantineJournal } from "./localFirstCorruption";
import { chooseRebuildSource, describeRebuild } from "./localFirstRebuild";
import { baselineOf, statLegacyJournal, writeLegacyBaseline, type LegacyStat } from "./localFirstLegacyMerge";
import { yieldToEventLoop, type LoadedJournal, type NodeJournalIo } from "./localFirstJournalIo";
import { PRE_V3_SUFFIX, readLegacyJournal, readSnapshotCache, retireSnapshotCache } from "./localFirstMigration";
import { snapshotHasState } from "./localFirstSnapshotFile";

const fs = nodeFs.promises;

/** What the rebuilds need from the store, injected so the store stays a composition. */
export interface RecoveryPorts {
  directory: string;
  snapshotFile: string;
  io: NodeJournalIo;
  lock: LocalFirstFileLock;
  /** How long an open waits for the lock (an import holds it far longer than a commit). */
  openWaitMs: number;
  onBackgroundError: (error: unknown) => void;
  /** Adopt a loaded journal as the store's state. `silent` for the open, which nobody is waiting on. */
  adopt(loaded: LoadedJournal, silent: boolean): void;
  replaceMemory(snapshot: LocalFirstSnapshot, silent: boolean): void;
}

export interface Recovery {
  importLegacy(): Promise<void>;
  rebuildCorrupt(loaded: LoadedJournal, held?: LocalFirstSnapshot): Promise<void>;
  /** Best effort: remove the pre-v3 rollback copy of the JSON cache. Never fails the open. */
  retirePreV3Snapshot(): Promise<void>;
}

export function createRecovery(ports: RecoveryPorts): Recovery {
  const { directory, snapshotFile, io, lock, openWaitMs, onBackgroundError, adopt, replaceMemory } = ports;

  /** The baseline of v2 as just imported, so a later open merges only what an old window adds. */
  const recordImportBaseline = async (source: LocalFirstSnapshot | undefined, legacy: LegacyStat | undefined): Promise<void> => {
    if (legacy) await writeLegacyBaseline(directory, baselineOf(source ?? EMPTY_LOCAL_FIRST_SNAPSHOT, legacy)).catch(onBackgroundError);
  };

  /**
   * First open with no v3 journal and an older store to bring over. UNDER THE LOCK: two
   * windows can open at once, and the loser must find the winner's v3 rather than write its
   * own. v2 is only read; v3 is written as a stream of frames; the JSON cache of v2's state is
   * set aside so it is never parsed again. A damaged v3 takes the same road (`rebuildCorrupt`).
   */
  const importLegacy = async (): Promise<void> => {
    await fs.mkdir(directory, { recursive: true });
    await lock.acquire(openWaitMs);
    try {
      const raced = await io.load(yieldToEventLoop);
      if (raced.corrupt) {
        await rebuildCorrupt(raced);
        return;
      }
      if (raced.latest) {
        adopt(raced, true);
        return;
      }
      const legacy = await statLegacyJournal(directory); // before the read: a later write must show as a change
      const fromJournal = await readLegacyJournal(directory, yieldToEventLoop);
      const source = fromJournal ?? await readSnapshotCache(snapshotFile);
      if (source && snapshotHasState(source)) {
        await io.compact(source, yieldToEventLoop);
        replaceMemory(source, true);
      } else {
        adopt(raced, true);
      }
      await recordImportBaseline(source, legacy);
      if (fromJournal) await retireSnapshotCache(snapshotFile).catch(onBackgroundError);
    } finally {
      await lock.release();
    }
  };

  /**
   * UNDER THE LOCK: v3 is damaged (not torn). It is copied aside whole and never truncated, then
   * rebuilt from the best source left (`localFirstRebuild.ts`): this window's own state, the sound
   * prefix, or the newer of the cache and v2. With none, the open is refused `local_first_store_corrupt`.
   */
  const rebuildCorrupt = async (loaded: LoadedJournal, held?: LocalFirstSnapshot): Promise<void> => {
    const copy = await quarantineJournal(io.journalFile);
    const plan = await chooseRebuildSource({ directory, snapshotFile, loaded, held, pause: yieldToEventLoop });
    if (!plan) throw new LocalFirstStoreCorruptError(copy);
    await io.compact(plan.snapshot, yieldToEventLoop);
    replaceMemory(plan.snapshot, false);
    if (plan.from === "v2") await recordImportBaseline(plan.snapshot, plan.legacy);
    onBackgroundError(new Error(describeRebuild(plan, copy, loaded, (await fs.stat(copy)).size)));
  };

  /**
   * The pre-v3 rollback copy of the JSON cache (`local-first-v1.json.pre-v3`). It is only
   * written by a legacy import, so it exists exactly when an import completed; a healthy v3
   * open means v3 is the record and the copy only costs disk. Best effort: a failure to
   * remove it must never fail the open. The v2 journal is NOT removed here: the merge
   * baseline tracks it by size/mtime and still needs it present to detect (and merge) a
   * write an old window makes to v2 after v3 went live.
   */
  const retirePreV3Snapshot = async (): Promise<void> => {
    try {
      await fs.rm(`${snapshotFile}${PRE_V3_SUFFIX}`, { force: true });
    } catch (error) {
      onBackgroundError(error);
    }
  };

  return { importLegacy, rebuildCorrupt, retirePreV3Snapshot };
}

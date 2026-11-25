/**
 * Choosing what a DAMAGED v3 journal is rebuilt from (the copy is already set aside by
 * `quarantineJournal`). Best source first, so one bad frame never rolls the store back further
 * than it must:
 *
 *   1. `memory`  — this window already holds everything it tracked up to `committedBytes`
 *                  (the commit path only).
 *   2. `prefix`  — the base closed, so the fold up to the damage is sound.
 *   3. `cache` / `v2` — the base itself is damaged: the NEWER of `local-first-v1.json` and v2.
 *   4. nothing   — the caller rejects `local_first_store_corrupt`.
 *
 * Only a `v2` rebuild rewrites the import sidecar (the baseline describes what v2 held).
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import type { LocalFirstSnapshot } from "@builderforce/local-first";
import { LEGACY_JOURNAL_FILE, type LoadedJournal } from "./localFirstJournalIo";
import { readLegacyJournal, readSnapshotCache } from "./localFirstMigration";
import { snapshotHasState } from "./localFirstSnapshotFile";
import { statLegacyJournal, type LegacyStat } from "./localFirstLegacyMerge";

const fs = nodeFs.promises;

export interface RebuildPlan {
  snapshot: LocalFirstSnapshot;
  from: "memory" | "prefix" | "cache" | "v2";
  /** v2's stat taken before it was read; set only for `from: "v2"`. */
  legacy?: LegacyStat;
}

const mtimeOf = async (path: string): Promise<number> => {
  try {
    return (await fs.stat(path)).mtimeMs;
  } catch {
    return -1;
  }
};

export async function chooseRebuildSource(input: {
  directory: string;
  snapshotFile: string;
  loaded: LoadedJournal;
  /** The window's own state, on the commit path. */
  held?: LocalFirstSnapshot;
  pause: () => Promise<void>;
}): Promise<RebuildPlan | undefined> {
  const { directory, snapshotFile, loaded, held, pause } = input;
  if (held) return { snapshot: held, from: "memory" };
  if (loaded.latest && loaded.baseClosed) return { snapshot: loaded.latest, from: "prefix" };
  const sources = [
    { from: "cache" as const, mtime: await mtimeOf(snapshotFile) },
    { from: "v2" as const, mtime: await mtimeOf(nodePath.join(directory, LEGACY_JOURNAL_FILE)) },
  ].filter((source) => source.mtime >= 0).sort((a, b) => b.mtime - a.mtime);
  for (const source of sources) {
    if (source.from === "cache") {
      const snapshot = await readSnapshotCache(snapshotFile);
      if (snapshot && snapshotHasState(snapshot)) return { snapshot, from: "cache" };
    } else {
      const legacy = await statLegacyJournal(directory);
      const snapshot = await readLegacyJournal(directory, pause);
      if (snapshot && snapshotHasState(snapshot)) return { snapshot, from: "v2", ...(legacy ? { legacy } : {}) };
    }
  }
  return undefined;
}

const SOURCE_NAMES: Record<RebuildPlan["from"], string> = {
  memory: "this window's own state",
  prefix: "the sound prefix of the journal",
  cache: "the snapshot cache",
  v2: "the v2 journal",
};

/** The line reported when a damaged journal was rebuilt. */
export function describeRebuild(plan: RebuildPlan, copy: string, loaded: LoadedJournal, fileBytes: number): string {
  const dropped = Math.max(0, fileBytes - loaded.committedBytes);
  return `local-first: journal damaged; original kept at ${copy}; rebuilt from ${SOURCE_NAMES[plan.from]} `
    + `(${loaded.frames} good frames before the damage, ${dropped} bytes after them not trusted)`;
}

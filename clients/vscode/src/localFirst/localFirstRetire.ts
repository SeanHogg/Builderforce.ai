/**
 * Retiring the files a v4 store no longer reads (AE-G031 "Retirement"). The existing retire step
 * (`retirePreV3Snapshot`, which removes the pre-v3 JSON copy once v3 opened cleanly) calls this once v4 has
 * opened cleanly. Until then the files stay, because an old window's writes are merged from them
 * (`localFirstV4Merge.ts`, `localFirstLegacyMerge.ts`).
 *
 *   - v3's journal goes only when ALL hold: it has not grown for `RETIRE_AFTER_MS`, counted from the later of
 *     its last write and the moment v4 was cut from it (`migratedAt`); every frame past the baseline has been
 *     merged (`v3Moved` is undefined); and the baseline sidecar parsed. A migration that just ran, a merge that
 *     failed, or a sidecar that cannot be read each keep it.
 *   - the stray `local-first-v2.journal`, `*.pre-migration.*`, `local-first-v3.import.json` go when each has not
 *     grown for the same period.
 *
 * A file that will not go stays for the next open, and the failure is reported.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import { JOURNAL_FILE, LEGACY_JOURNAL_FILE } from "./localFirstJournalIo";
import { IMPORT_SIDECAR_FILE } from "./localFirstLegacyMerge";
import { readV3Baseline, v3Moved } from "./localFirstV4Merge";

const fs = nodeFs.promises;

export const RETIRE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

const PRE_MIGRATION = /^local-first-v[23]\.journal\.pre-migration\.(bak|json)$/;
const STRAYS: ReadonlySet<string> = new Set([LEGACY_JOURNAL_FILE, IMPORT_SIDECAR_FILE, `${JOURNAL_FILE}.migration-disabled`]);

/** The age v3 counts from, or `undefined` when v3 may not be retired at all (not fully merged, or no readable baseline). */
async function v3Anchor(directory: string): Promise<number | undefined> {
  const baseline = await readV3Baseline(directory);
  if (!baseline || await v3Moved(directory)) return undefined;
  const migratedAt = Date.parse(baseline.migratedAt);
  return Number.isFinite(migratedAt) ? migratedAt : undefined;
}

/** The names removed this pass. */
export async function retireOldFormats(directory: string, onError: (error: unknown) => void, now: number = Date.now()): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    onError(error);
    return [];
  }
  let anchor: number | undefined;
  if (names.includes(JOURNAL_FILE)) {
    try {
      anchor = await v3Anchor(directory);
    } catch (error) {
      onError(error); // an unreadable sidecar: v3 stays
    }
  }
  const retired: string[] = [];
  for (const name of names) {
    const isV3 = name === JOURNAL_FILE;
    if (!isV3 && !STRAYS.has(name) && !PRE_MIGRATION.test(name)) continue;
    if (isV3 && anchor === undefined) continue;
    const path = nodePath.join(directory, name);
    try {
      const wrote = (await fs.stat(path)).mtimeMs;
      if (now - Math.max(wrote, isV3 ? anchor! : 0) < RETIRE_AFTER_MS) continue;
      await fs.rm(path, { force: true });
      retired.push(name);
    } catch (error) {
      onError(error);
    }
  }
  return retired;
}

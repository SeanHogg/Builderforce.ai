/**
 * Retiring the files a v4 store no longer reads (AE-G031 "Retirement"). The existing retire step
 * (`retirePreV3Snapshot`, which removes the pre-v3 JSON copy once v3 opened cleanly) calls this once v4 has
 * opened cleanly: each file below is removed when it has not grown for `RETIRE_AFTER_MS`, i.e. when no old
 * window is still writing it. Until then they stay, because an old window's writes are merged from them
 * (`localFirstV4Merge.ts`, `localFirstLegacyMerge.ts`). Best effort: a file that will not go stays.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import { JOURNAL_FILE, LEGACY_JOURNAL_FILE } from "./localFirstJournalIo";
import { IMPORT_SIDECAR_FILE } from "./localFirstLegacyMerge";

const fs = nodeFs.promises;

export const RETIRE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

const PRE_MIGRATION = /^local-first-v[23]\.journal\.pre-migration\.(bak|json)$/;
const RETIRED_NAMES: ReadonlySet<string> = new Set([JOURNAL_FILE, LEGACY_JOURNAL_FILE, IMPORT_SIDECAR_FILE, `${JOURNAL_FILE}.migration-disabled`]);

/** The names removed this pass. */
export async function retireOldFormats(directory: string, now: number = Date.now()): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }
  const retired: string[] = [];
  for (const name of names) {
    if (!RETIRED_NAMES.has(name) && !PRE_MIGRATION.test(name)) continue;
    const path = nodePath.join(directory, name);
    try {
      if (now - (await fs.stat(path)).mtimeMs < RETIRE_AFTER_MS) continue;
      await fs.rm(path, { force: true });
      retired.push(name);
    } catch {
      // left for the next open
    }
  }
  return retired;
}

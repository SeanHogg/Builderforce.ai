/**
 * The file a sub-agent's collected data is kept in, for its owner to `read_file` (VS Code
 * chat #273: 41 calls' rows were lost with the child, and the owner re-fetched every page).
 *
 *   - {@link saveCollectedData}: the spawner's side — the child's data calls rendered
 *     (`collectedDataText`, secrets redacted) and handed to the host's `saveChildData` port;
 *     a failed save is reported on the child's trace, never dropped silently.
 *   - {@link writeChildDataFile}: the host's side — written under the workspace's git-ignored
 *     cache (`ensureIgnoredCacheDir`), then the folder is pruned ({@link pruneChildDataFiles})
 *     so it never grows without bound.
 *
 * The data is read from the child's trace, which keeps only its last 500 events: a long
 * child's earliest calls may be missing (the file says so).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { noteRunStep, type RunLineage } from "@seanhogg/builderforce-brain-embedded";
import { collectedDataText, type CoverageStep } from "./childCoverage";
import { CACHE_DIR, ensureIgnoredCacheDir } from "../shared/ignoredCacheDir";
import type { ChildRunHost } from "./childRunSpawner";
import { messageOf } from "../shared/messageOf";

/** The sub-folder of the workspace cache the data files live in. */
export const CHILD_DATA_SUBDIR = "subagents";

/** Files kept: the newest {@link MAX_CHILD_DATA_FILES}, none older than {@link CHILD_DATA_MAX_AGE_MS}. */
export const MAX_CHILD_DATA_FILES = 40;
export const CHILD_DATA_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** A failure caught here, recorded on the child's own trace — never swallowed. */
export function noteChildFailure(key: number, label: string, error: unknown): void {
  noteRunStep(key, { label, result: messageOf(error) });
}

/** Save what the child's calls returned for its owner; the path, or undefined (reported on its trace when the save failed). */
export async function saveCollectedData(
  host: Pick<ChildRunHost, "saveChildData">,
  key: number,
  lineage: RunLineage,
  trace: readonly CoverageStep[],
): Promise<string | undefined> {
  if (!host.saveChildData) return undefined;
  const text = collectedDataText(trace, `Data collected by sub-agent ${lineage.handle} · ${lineage.agent.name} — ${lineage.label}`);
  if (!text) return undefined;
  try {
    return await host.saveChildData(lineage.rootChatId, lineage.handle, text);
  } catch (error) {
    noteChildFailure(key, "run.child_data_unsaved", error);
    return undefined;
  }
}

/** Write one child's data file under `root`; the workspace-relative path. Prunes the folder after. */
export async function writeChildDataFile(root: string, rootChatId: number, handle: string, text: string, now: number = Date.now()): Promise<string> {
  const dir = await ensureIgnoredCacheDir(root, CHILD_DATA_SUBDIR);
  const name = `chat${rootChatId}-${handle.replace(/[^\w-]/g, "_")}.md`;
  await fs.writeFile(path.join(dir, name), text, "utf8");
  await pruneChildDataFiles(dir, now, name);
  return [...CACHE_DIR, CHILD_DATA_SUBDIR, name].join("/");
}

/**
 * Drop data files past the age limit, and the oldest beyond the count limit. `keep` (the
 * file just written) is never dropped. Returns the names removed.
 */
export async function pruneChildDataFiles(dir: string, now: number = Date.now(), keep?: string): Promise<string[]> {
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md") && n !== keep);
  const stamped = await Promise.all(names.map(async (name) => ({ name, mtime: (await fs.stat(path.join(dir, name))).mtimeMs })));
  stamped.sort((a, b) => b.mtime - a.mtime);
  const room = MAX_CHILD_DATA_FILES - (keep ? 1 : 0);
  const drop = stamped.filter((f, i) => i >= room || now - f.mtime > CHILD_DATA_MAX_AGE_MS).map((f) => f.name);
  await Promise.all(drop.map((name) => fs.rm(path.join(dir, name), { force: true })));
  return drop;
}

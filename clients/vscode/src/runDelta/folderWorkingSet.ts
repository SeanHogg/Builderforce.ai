/**
 * The working set of a NON-GIT workspace folder (PRD 41 §C1, "Non-git workspaces"): every file a run could have touched,
 * listed so the baseline can fingerprint (and pre-image) all of it, and the finalization can diff it against a second
 * listing. Git roots never come here: their working set is `git status`.
 *
 * The walk skips what the knowledge walk skips (`isSkippedPath`: dependency folders, VCS metadata), BuilderForce's own state
 * (`listsFile`; the repository's `.builderforce/delta.json` is kept: it is an input the delta reads), and any nested git
 * checkout (a repository is its own baseline entry, never part of the folder's). It stops at {@link WORKING_SET_MAX_FILES},
 * the knowledge listing's cap, and says so (`truncated`): a capped listing cannot tell a deleted file from an unlisted one, so
 * the change set does not attribute a truncated folder.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isSkippedPath, listsFile, MAX_LISTED_FILES } from "@builderforce/agent-tools/knowledge";

export const WORKING_SET_MAX_FILES = MAX_LISTED_FILES;

export interface WorkingSetFile {
  /** Absolute path. */
  path: string;
  /** Folder-relative POSIX path. */
  relativePath: string;
}

const DELTA_OVERRIDES = ".builderforce/delta.json";

/** Every listed file under `root`, sorted by relative path; empty when the folder cannot be read. */
export async function listWorkingSet(root: string, maxFiles: number = WORKING_SET_MAX_FILES): Promise<{ files: WorkingSetFile[]; truncated: boolean }> {
  const out: WorkingSetFile[] = [];
  let truncated = false;
  const pending: string[] = [""];
  while (pending.length > 0 && out.length < maxFiles) {
    const dirRel = pending.shift()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(root, dirRel), { withFileTypes: true });
    } catch {
      continue; // gone or unreadable: nothing to list there
    }
    // A nested checkout is a repository of its own: the baseline records it as one.
    if (dirRel && entries.some((e) => e.name === ".git")) continue;
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (out.length >= maxFiles) { truncated = true; break; }
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!isSkippedPath(`${rel}/`)) pending.push(rel);
      } else if (entry.isFile() && (listsFile(rel) || rel === DELTA_OVERRIDES) && !isSkippedPath(rel)) {
        out.push({ path: path.join(root, rel), relativePath: rel });
      }
    }
  }
  if (pending.length > 0) truncated = true;
  const files = out.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  return { files, truncated };
}

/**
 * The working-set "status" of a non-git folder at finalization: every file listed now, plus every baseline file that is no
 * longer there (`deleted`). Files not in the baseline are `untracked` (the run created them).
 */
export function workingSetStatus(
  baselineFiles: Readonly<Record<string, unknown>>,
  listed: readonly WorkingSetFile[],
  root: string,
): Array<WorkingSetFile & { status: "modified" | "untracked" | "deleted" }> {
  const now = new Set(listed.map((f) => f.relativePath));
  const out: Array<WorkingSetFile & { status: "modified" | "untracked" | "deleted" }> = listed.map((f) => ({
    ...f,
    status: f.relativePath in baselineFiles ? "modified" : "untracked",
  }));
  for (const rel of Object.keys(baselineFiles)) {
    if (!now.has(rel)) out.push({ path: path.join(root, rel), relativePath: rel, status: "deleted" });
  }
  return out.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
}

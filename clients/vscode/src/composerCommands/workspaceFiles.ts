/**
 * A workspace folder's text files, bounded, for app detection (`/manifest init`, and
 * `/launch` with no manifest). The exclusions and caps are the LOCAL LAUNCHER's own
 * (`EXCLUDED_DIRECTORIES`, `PROJECT_LIMITS`), so detection sees the same tree the launcher
 * serves the runtime — never `node_modules`, `.git` or a build output. Of `.builderforce/`
 * only the manifest is read, and it is read first (`MANIFEST_PATH`); a legacy root manifest
 * is read with the rest of the root, and the detector prefers the canonical one.
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDED_DIRECTORIES, PROJECT_LIMITS } from "@seanhogg/builderforce-webcontainers/launcher/server";
import { MANIFEST_PATH, WORKSPACE_DIR } from "./manifestLocation";

export interface WorkspaceFileLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

const EXCLUDED = new Set(EXCLUDED_DIRECTORIES);

/** A subdirectory or file that could not be read: reported, and detection goes on without it. */
export type WorkspaceFileReport = (error: unknown, relativePath: string) => void;

/**
 * Project-relative POSIX path → text. A binary file (a NUL byte) or one over the caps is skipped.
 * An unreadable subdirectory or file never aborts detection: it is reported and left out. The
 * folder itself being unreadable rejects.
 */
export async function readWorkspaceFiles(
  root: string,
  report: WorkspaceFileReport,
  limits: WorkspaceFileLimits = PROJECT_LIMITS,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let total = 0;
  /**
   * Read one regular file into `files`, within the caps; an unreadable one is reported and
   * skipped. `probe`: a path read without a listing, so its absence is normal, not a failure.
   */
  const readOne = async (relative: string, probe = false): Promise<void> => {
    const absolute = path.join(root, ...relative.split("/"));
    let size: number;
    let text: string;
    try {
      const info = await lstat(absolute);
      if (!info.isFile()) return; // a link or a device: never followed out of the folder
      size = info.size;
      if (size > limits.maxFileBytes || total + size > limits.maxTotalBytes) return;
      text = await readFile(absolute, "utf8");
    } catch (error) {
      const absent = (error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR";
      if (!(probe && absent)) report(error, relative);
      return;
    }
    if (text.includes("\u0000")) return;
    files.set(relative, text);
    total += size;
  };

  // The manifest first, so the caps never cut it; the rest of `.builderforce/` (hooks, logs,
  // the extension's own state) is not the app, so detection never walks it.
  await readOne(MANIFEST_PATH, true);
  const queue: string[] = [""];
  while (queue.length > 0 && files.size < limits.maxFiles) {
    const relativeDir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(path.join(root, ...relativeDir.split("/")), { withFileTypes: true });
    } catch (error) {
      if (relativeDir === "") throw error;
      report(error, relativeDir);
      continue;
    }
    for (const entry of entries) {
      if (files.size >= limits.maxFiles) break;
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!EXCLUDED.has(entry.name) && relative !== WORKSPACE_DIR) queue.push(relative);
        continue;
      }
      if (entry.isFile()) await readOne(relative); // symlinks and devices: never followed out of the folder
    }
  }
  return files;
}

/**
 * A workspace folder's text files, bounded, for app detection (`/manifest init`, and
 * `/launch` with no `builderforce.json`). The exclusions and caps are the LOCAL
 * LAUNCHER's own (`EXCLUDED_DIRECTORIES`, `PROJECT_LIMITS`), so detection sees the same
 * tree the launcher serves the runtime — never `node_modules`, `.git` or a build output.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDED_DIRECTORIES, PROJECT_LIMITS } from "@seanhogg/builderforce-webcontainers/launcher/server";

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
        if (!EXCLUDED.has(entry.name)) queue.push(relative);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks and devices: never followed out of the folder
      const absolute = path.join(root, ...relative.split("/"));
      let size: number;
      let text: string;
      try {
        ({ size } = await stat(absolute));
        if (size > limits.maxFileBytes || total + size > limits.maxTotalBytes) continue;
        text = await readFile(absolute, "utf8");
      } catch (error) {
        report(error, relative);
        continue;
      }
      if (text.includes("\u0000")) continue;
      files.set(relative, text);
      total += size;
    }
  }
  return files;
}

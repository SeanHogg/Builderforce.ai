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

/** Project-relative POSIX path → text. A binary file (a NUL byte) or one over the caps is skipped. */
export async function readWorkspaceFiles(root: string, limits: WorkspaceFileLimits = PROJECT_LIMITS): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let total = 0;
  const queue: string[] = [""];
  while (queue.length > 0 && files.size < limits.maxFiles) {
    const relativeDir = queue.shift()!;
    const entries = await readdir(path.join(root, relativeDir), { withFileTypes: true });
    for (const entry of entries) {
      if (files.size >= limits.maxFiles) break;
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!EXCLUDED.has(entry.name)) queue.push(relative);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks and devices: never followed out of the folder
      const absolute = path.join(root, ...relative.split("/"));
      const { size } = await stat(absolute);
      if (size > limits.maxFileBytes || total + size > limits.maxTotalBytes) continue;
      const text = await readFile(absolute, "utf8");
      if (text.includes("\u0000")) continue;
      files.set(relative, text);
      total += size;
    }
  }
  return files;
}

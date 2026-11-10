/**
 * The bounded working-tree walk + size-capped, cached file reader the governance
 * pre-filters scan (PRD 08 §4.2 step 2).
 */

import fs from "node:fs/promises";
import path from "node:path";

/** Directories never worth scanning. */
const WALK_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "vendor",
  "target",
  "__pycache__",
]);

/** Extensions that are never text-scanned (binary by nature). */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".jar",
  ".class",
]);

export const MAX_WALK_FILES = 10_000;
export const MAX_SCAN_BYTES = 512 * 1024;

/**
 * Dot-directories that are policy-relevant and therefore walked (everything else
 * starting with a dot that is a DIRECTORY is skipped). Dot-FILES are always listed —
 * `.env` is exactly what a forbidden-path rule looks for.
 */
const WALKED_DOT_DIRS = new Set([".builderforce", ".github"]);

export function isProbablyBinaryPath(relPath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

/** Walk the working tree (bounded) returning sorted repo-relative POSIX file paths. */
export async function walkWorkingTree(root: string, maxFiles = MAX_WALK_FILES): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && files.length < maxFiles) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (WALK_SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".") && !WALKED_DOT_DIRS.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        files.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }
  return files.sort();
}

/** Reads a repo-relative path as text; null when binary, too large, or unreadable. */
export type WorkingTreeReader = (relPath: string) => Promise<string | null>;

/**
 * A lazily-reading, per-audit cached reader rooted at `root`. A file over
 * {@link MAX_SCAN_BYTES} is not scanned; `onOversize` is told so the caller can
 * surface the coverage gap instead of dropping it silently.
 */
export function createWorkingTreeReader(
  root: string,
  onOversize?: (relPath: string, bytes: number) => void,
): WorkingTreeReader {
  const cache = new Map<string, Promise<string | null>>();
  return (relPath) => {
    let cached = cache.get(relPath);
    if (!cached) {
      cached = (async () => {
        try {
          const full = path.join(root, ...relPath.split("/"));
          const { size } = await fs.stat(full);
          if (size > MAX_SCAN_BYTES) {
            onOversize?.(relPath, size); // too large to scan cheaply — a recorded gap, never read
            return null;
          }
          const buf = await fs.readFile(full);
          if (buf.includes(0)) return null; // binary
          return buf.toString("utf8");
        } catch {
          return null;
        }
      })();
      cache.set(relPath, cached);
    }
    return cached;
  };
}

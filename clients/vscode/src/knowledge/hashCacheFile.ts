/**
 * The directory source's hash cache, kept across sessions in the root's own knowledge folder
 * (`hash-cache.json` beside the manifest): a restart re-hashes only what changed on disk, not a whole
 * repository. Keys are absolute paths with the (mtime, size) they were hashed at, so a stale entry
 * never matches. Bounded; a missing, corrupt or foreign file starts empty.
 */

import { createHash } from "node:crypto";
import type { KnowledgeFiles } from "./knowledgeStores";
import type { HashCache } from "./vscodeDirectorySource";

export const HASH_CACHE_FILE = "hash-cache.json";
/** Entries kept per root (the walk lists at most 20,000 files). */
export const HASH_CACHE_MAX_ENTRIES = 30_000;
const VERSION = 1;

type Row = [path: string, mtime: number, size: number, hash: string];

/** SHA-256 of the bytes as lowercase hex: the same digest as memory's `sha256Hex`, computed natively. */
export const nodeSha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const slash = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");

const isRow = (r: unknown): r is Row =>
  Array.isArray(r) && r.length === 4 && typeof r[0] === "string" && typeof r[1] === "number" && typeof r[2] === "number" && typeof r[3] === "string";

export interface PersistentHashCache {
  /** Reads the saved entries for the root into the shared cache (once per process per root). */
  load(): Promise<void>;
  /** Writes the root's entries (bounded to the newest {@link HASH_CACHE_MAX_ENTRIES}). */
  save(): Promise<void>;
}

const loaded = new Set<string>();

export function persistentHashCache(files: KnowledgeFiles, rootPath: string, cache: HashCache): PersistentHashCache {
  const prefix = `${slash(rootPath)}/`;
  return {
    async load() {
      if (loaded.has(prefix)) return;
      loaded.add(prefix);
      try {
        const parsed = JSON.parse((await files.read(HASH_CACHE_FILE)) ?? "null") as { v?: number; rows?: unknown } | null;
        if (parsed?.v !== VERSION || !Array.isArray(parsed.rows)) return;
        for (const row of parsed.rows) {
          if (isRow(row) && row[0].startsWith(prefix) && !cache.has(row[0])) cache.set(row[0], { mtime: row[1], size: row[2], hash: row[3] });
        }
      } catch {
        // Corrupt: start empty.
      }
    },
    async save() {
      const rows: Row[] = [];
      for (const [path, e] of cache) if (path.startsWith(prefix)) rows.push([path, e.mtime, e.size, e.hash]);
      // Map order is insertion order: the newest entries are last.
      await files.write(HASH_CACHE_FILE, JSON.stringify({ v: VERSION, rows: rows.slice(-HASH_CACHE_MAX_ENTRIES) }));
    },
  };
}

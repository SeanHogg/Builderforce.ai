/**
 * THE L3 result cache's store in the editor (agent-tools `delta/adapters/l3Cache.ts`, PRD 41 §B7, B8.3): one small JSON
 * file per key under the repository's `.builderforce/cache/run-delta-analyzers/` (ignored by git and by the knowledge
 * watcher). Read and written by BOTH whole-tree analyzer runs — the background indexer's L3 pass (`l3Binding.ts`, through
 * `analyseWorkspace`) and the run delta's tier (`repoAnalyzers.ts`) — so there is one cache, not two. Only `ok` results
 * are kept. The key is the shared one ({@link l3KeyOf}).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { L3CacheEntry, L3ResultCache } from "@builderforce/agent-tools";
import { CACHE_DIR, ensureIgnoredCacheDir } from "../../shared/ignoredCacheDir";

const ANALYZER_CACHE_SUBDIR = "run-delta-analyzers";

export { l3CacheKey as cacheKeyOf } from "@builderforce/agent-tools";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The store of one repository root. Never throws: a miss or an unwritable folder is just no cache. */
export function fileAnalyzerCache(root: string): L3ResultCache {
  const dir = path.join(root, ...CACHE_DIR, ANALYZER_CACHE_SUBDIR);
  return {
    async get(key, tool) {
      try {
        const entry = JSON.parse(await fs.readFile(path.join(dir, `${key}.json`), "utf8")) as L3CacheEntry;
        const r = entry?.result;
        return r && r.tool === tool && r.status === "ok" && Array.isArray(r.findings) ? entry : undefined;
      } catch {
        return undefined;
      }
    },
    async put(key, entry) {
      if (entry.result.status !== "ok") return;
      try {
        await ensureIgnoredCacheDir(root, ANALYZER_CACHE_SUBDIR);
        await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify(entry), "utf8");
      } catch {
        /* no cache this time */
      }
    },
  };
}

export type AnalyzerCache = L3ResultCache;

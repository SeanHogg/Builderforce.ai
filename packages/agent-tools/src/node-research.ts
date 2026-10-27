/**
 * The Node half of the `local.research` capability — everything a disk-backed surface
 * needs besides its local model: file fingerprints off the working tree (mtime + size,
 * what the answer cache is keyed on) and the persisted answer cache,
 * `<root>/.builderforce/research-cache.json`.
 *
 * Shared by every Node surface that offers `local_research` (the VS Code extension and
 * the on-prem runtime), so the cache file, its format and its write discipline are one
 * implementation. The surface supplies only the model: {@link nodeResearchCapability}.
 *
 * Node-only (`fs`), so it rides the `./node-research` export condition.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LocalResearchCapability, LocalResearchMessage, ResearchAnswerStore, ResearchFileFingerprint } from "./research-capability.js";
import { ResearchLru } from "./researchCache.js";
import { resolveInsideRootOrThrow } from "./node-path.js";

/** The cache file, relative to the workspace root (beside the symbol snapshot). */
export const RESEARCH_CACHE_FILE = path.join(".builderforce", "research-cache.json");

const stores = new Map<string, ResearchAnswerStore>();

/**
 * A store over `file`: loaded once, written back after each new answer (serialized,
 * best-effort — an unwritable cache only costs a re-ask). The keying and the LRU bound
 * are the shared, pure {@link ResearchLru}.
 */
export function fileResearchStore(file: string, maxEntries?: number): ResearchAnswerStore {
  let lru: Promise<ResearchLru> | null = null;
  let writing: Promise<void> = Promise.resolve();
  const load = (): Promise<ResearchLru> => {
    lru ??= fs.readFile(file, "utf-8").then(
      (raw) => ResearchLru.fromJSON(JSON.parse(raw), maxEntries),
      () => new ResearchLru(maxEntries),
    ).catch(() => new ResearchLru(maxEntries));
    return lru;
  };
  return {
    async get(key) {
      return (await load()).get(key);
    },
    async set(key, answer) {
      const cache = await load();
      cache.set(key, answer);
      writing = writing.then(async () => {
        try {
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, JSON.stringify(cache.toJSON()), "utf-8");
        } catch {
          /* best-effort */
        }
      });
      await writing;
    },
  };
}

/** The process-wide cache for the workspace at `root` (one store per file, so two
 *  callers never race each other's write-back). */
export function researchCacheStore(root: string): ResearchAnswerStore {
  const file = path.join(path.resolve(root), RESEARCH_CACHE_FILE);
  let store = stores.get(file);
  if (!store) {
    store = fileResearchStore(file);
    stores.set(file, store);
  }
  return store;
}

/** mtime + size of each readable file under `root`; anything else is left out. */
export async function workspaceFingerprints(root: string, paths: readonly string[]): Promise<ResearchFileFingerprint[]> {
  const out: ResearchFileFingerprint[] = [];
  for (const p of paths) {
    try {
      const stat = await fs.stat(resolveInsideRootOrThrow(root, p));
      if (stat.isFile()) out.push({ path: p, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      /* outside the root, missing, unreadable — not part of the answer */
    }
  }
  return out;
}

/** The one thing a surface brings: a completion on a model on THIS machine only. */
export interface LocalResearchModel {
  complete(messages: readonly LocalResearchMessage[], signal: AbortSignal): Promise<string>;
}

/** The `local.research` backing for the workspace at `root`, over the surface's model. */
export function nodeResearchCapability(root: string, model: LocalResearchModel): LocalResearchCapability {
  return {
    complete: (messages, signal) => model.complete(messages, signal),
    fingerprint: (paths) => workspaceFingerprints(root, paths),
    cache: researchCacheStore(root),
  };
}

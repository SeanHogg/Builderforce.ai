/**
 * The editor's `DirectorySource` (PRD 38 §4.7, VS Code row): a workspace folder, or any
 * folder inside one, as memory's review reads it — the ONE filesystem walker
 * (`@builderforce/agent-tools/knowledge` `createFsDirectorySource`: SHA-256 per file,
 * cached by mtime + size; `.builderforce/` state never listed) over `vscode.workspace.fs`
 * (`knowledgeFs.ts`), skipping the ONE list every host's review skips (`KNOWLEDGE_SKIP_DIRS`).
 *
 * This host hashes natively (`node:crypto`, the same lowercase-hex SHA-256) and never reads a
 * file the plan skips as too large (it needs the size only).
 */

import { createFsDirectorySource, type FsDirectorySource, type HashCache, type KnowledgeFs } from "@builderforce/agent-tools/knowledge";
import { DEFAULT_MAX_FILE_BYTES } from "@seanhogg/builderforce-memory/knowledge";
import { nodeSha256Hex } from "./hashCacheFile";

export type { HashCache, KnowledgeFs };

export interface DirectorySourceOptions {
  fs: KnowledgeFs;
  /** Absolute path of the folder reviewed. */
  rootPath: string;
  rootId: string;
  title: string;
  hashCache?: HashCache;
  /**
   * Files listed before the walk yields a macrotask to the extension host's event loop. A plan walk
   * hashes in this thread (batches through the workspace fs), and without a yield a large repo's
   * count would starve the UI until it finished. Default {@link EVENT_LOOP_YIELD_EVERY}; 0 disables.
   */
  yieldEvery?: number;
  /** The macrotask the walk awaits to yield the event loop; a test passes a fake to walk synchronously. */
  yieldDelay?: () => Promise<void>;
}

/** Files listed between event-loop yields on the extension host (a UI thread must keep ticking). */
export const EVENT_LOOP_YIELD_EVERY = 250;

/** The yield's event-loop hand-off: a macrotask, so pending UI work (and timers) run before the walk continues. */
export const eventLoopYield = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Wraps a source's `list()` so the walk hands the event loop a macrotask every `every` files. Every
 * other member (read, watch, the skipped/git folders) passes through untouched. Pure decoration, so
 * a test walks a source synchronously by passing `yieldEvery: 0`.
 */
export function withEventLoopYield<T extends FsDirectorySource>(source: T, every: number = EVENT_LOOP_YIELD_EVERY, yieldDelay: () => Promise<void> = eventLoopYield): T {
  if (every <= 0) return source;
  return {
    ...source,
    async *list() {
      let listed = 0;
      for await (const file of source.list()) {
        yield file;
        if (++listed % every === 0) await yieldDelay();
      }
    },
  } as T;
}

export function createDirectorySource(opts: DirectorySourceOptions): FsDirectorySource {
  const { yieldEvery, yieldDelay, ...rest } = opts;
  return withEventLoopYield(
    createFsDirectorySource({ ...rest, hash: nodeSha256Hex, skipHashAbove: DEFAULT_MAX_FILE_BYTES }),
    yieldEvery ?? EVENT_LOOP_YIELD_EVERY,
    yieldDelay ?? eventLoopYield,
  );
}

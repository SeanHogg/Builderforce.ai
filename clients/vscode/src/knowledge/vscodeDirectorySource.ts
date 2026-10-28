/**
 * The editor's `DirectorySource` (PRD 38 §4.7, VS Code row): a workspace folder, or any
 * folder inside one, as memory's review reads it — the ONE filesystem walker
 * (`@builderforce/agent-tools/knowledge` `createFsDirectorySource`: SHA-256 per file,
 * cached by mtime + size; `.builderforce/` state never listed) over `vscode.workspace.fs`
 * (`knowledgeFs.ts`), skipping the ONE list every host's review skips (`KNOWLEDGE_SKIP_DIRS`).
 */

import { createFsDirectorySource, type HashCache, type KnowledgeFs } from "@builderforce/agent-tools/knowledge";
import type { DirectorySource } from "@seanhogg/builderforce-memory/knowledge";

export type { HashCache, KnowledgeFs };

export interface DirectorySourceOptions {
  fs: KnowledgeFs;
  /** Absolute path of the folder reviewed. */
  rootPath: string;
  rootId: string;
  title: string;
  hashCache?: HashCache;
}

export function createDirectorySource(opts: DirectorySourceOptions): DirectorySource {
  return createFsDirectorySource(opts);
}

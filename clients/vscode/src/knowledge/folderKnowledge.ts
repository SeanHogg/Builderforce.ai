/**
 * The workspace folder's knowledge store (G03, PRD 41 B4): ONE SQLite file per folder
 * (`<folder>/.builderforce/cache/knowledge/index.sqlite`) holds every root reviewed in it, so the extension opens ONE
 * connection per folder and shares it between roots. A root's legacy `.builderforce/knowledge/<stem>.*` files are imported
 * the first time the root is opened (agent-tools `migrateLegacyKnowledge`); the store's first read waits for that import, and
 * `rootMigration` lets a review wait for it explicitly.
 */

import { migrateLegacyKnowledge, nodeKnowledgeStore, type NodeKnowledgeStore } from "@builderforce/agent-tools/node-knowledge-store";
import type { KnowledgeFiles } from "./knowledgeStores";

export interface FolderKnowledgeLog {
  info(line: string): void;
  error(what: string, error: unknown): void;
}

const folders = new Map<string, NodeKnowledgeStore>();
const migrations = new Map<string, Promise<void>>();

/** The folder's one store and manifest. `log.info` hears of a corrupt file that was moved aside and of a file from a newer format. */
export function folderKnowledge(folderPath: string, log?: Pick<FolderKnowledgeLog, "info">): NodeKnowledgeStore {
  let held = folders.get(folderPath);
  if (!held) {
    folders.set(folderPath, (held = nodeKnowledgeStore(folderPath)));
    if (held.recoveredFrom) log?.info(`knowledge index of ${folderPath} was corrupt; kept as ${held.recoveredFrom} and started empty (the next review re-indexes)`);
    if (held.formatNewer) log?.info(`knowledge index of ${folderPath} was written by a newer BuilderForce; it is read-only here until this extension is updated`);
  }
  return held;
}

const keyOf = (folderPath: string, rootId: string): string => `${folderPath}\u0000${rootId}`;

/**
 * The folder's store, with this root's legacy files queued for import (once per process). `files` is the root's
 * `migratingRootFiles`, so a root reviewed under an older id imports under its new one.
 */
export function openRootKnowledge(folderPath: string, rootId: string, files: KnowledgeFiles, legacyRootId: string | undefined, log: FolderKnowledgeLog): NodeKnowledgeStore {
  const folder = folderKnowledge(folderPath, log);
  const key = keyOf(folderPath, rootId);
  if (!migrations.has(key)) {
    migrations.set(key, migrateLegacyKnowledge(files, folder, rootId, { ...(legacyRootId ? { legacyRootId } : {}), log: (line) => log.info(line) })
      .then(() => undefined, (err: unknown) => log.error(`legacy knowledge import of ${rootId}`, err)));
  }
  return folder;
}

/** Resolves when the root's legacy import has finished (or failed: it is logged and never rejects). Resolved at once for a root not opened yet. */
export function rootMigration(folderPath: string, rootId: string): Promise<void> {
  return migrations.get(keyOf(folderPath, rootId)) ?? Promise.resolve();
}

/** Flushes every folder's unwritten rows, then closes its connection (extension deactivation, tests). */
export async function closeFolderKnowledge(): Promise<void> {
  const open = [...folders.values()];
  folders.clear();
  migrations.clear();
  for (const folder of open) {
    try {
      await folder.store.batched((flush) => flush()); // a held checkpoint must not be lost with the connection
    } catch { /* a failed flush keeps its rows dirty; the file stays as the last commit left it */ }
    folder.close();
  }
}

/**
 * Activation of the loaded knowledge packs (PRD 40): the registry is given its `globalState`,
 * and every remembered pack whose file still exists is re-indexed LAZILY — NOT at activation:
 * on the first pack recall, or on the first Visualizer session (a person pressed Run). A fresh
 * window (the index lives in memory with no folder open, and is rebuilt after an extension
 * update) answers about its packs without the person loading them again — but pressing Run or
 * asking a pack question is what re-seeds it, never the editor starting (the extension host
 * must never index at activation, `visualizerSession.ts`).
 * Call after `activateKnowledgeIndex` (it replaces the index registry the packs go into).
 */

import { logLine } from "../../errorReporter";
import { configureLoadedPacks, type PackMemento } from "./loadedPackRegistry";
import { configurePackErrors, reindexLoadedPacks } from "./packIndexing";

export function activateLoadedPacks(state: PackMemento): void {
  configureLoadedPacks(state);
  // One reporter for the lazy re-index and for every later recall of a pack.
  configurePackErrors((what, error) =>
    logLine(`[knowledge] ${what}: ${error instanceof Error ? error.message : String(error)}`),
  );
  // Lazily: the first pack recall, or the first Visualizer session, re-indexes the remembered
  // packs — never activation itself. No `await`: a missing file is a log line, not a failure.
  void reindexLoadedPacksLazily();
}

let lazilyStarted = false;
async function reindexLoadedPacksLazily(): Promise<void> {
  if (lazilyStarted) return;
  lazilyStarted = true;
  await reindexLoadedPacks();
}

/** Tests: forget whether the lazy re-index ran, so each test starts cold. */
export function resetPackReindex(): void {
  lazilyStarted = false;
}

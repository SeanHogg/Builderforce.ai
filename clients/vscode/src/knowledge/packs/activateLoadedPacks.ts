/**
 * Activation of the loaded knowledge packs (PRD 40): the registry is given its `globalState`,
 * and every remembered pack whose file still exists is re-indexed in the background — a
 * fresh window (the index lives in memory with no folder open, and is rebuilt after an
 * extension update) answers about its packs without the person loading them again.
 * Call after `activateKnowledgeIndex` (it replaces the index registry the packs go into).
 */

import { logLine } from "../../errorReporter";
import { configureLoadedPacks, type PackMemento } from "./loadedPackRegistry";
import { configurePackErrors, reindexLoadedPacks } from "./packIndexing";

export function activateLoadedPacks(state: PackMemento): void {
  configureLoadedPacks(state);
  // One reporter for the startup re-index and for every later recall of a pack.
  configurePackErrors((what, error) =>
    logLine(`[knowledge] ${what}: ${error instanceof Error ? error.message : String(error)}`),
  );
  // Not awaited: activation never waits on the packs, and a missing file is a log line, not a failure.
  void reindexLoadedPacks();
}

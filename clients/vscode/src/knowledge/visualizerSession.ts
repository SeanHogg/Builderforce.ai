/**
 * THE gate for when knowledge runs in the editor (PRD 41 B6, §6): nothing knowledge-side starts at
 * activation — a workspace folder is indexed (and its saves re-seed the index) only while a
 * Visualizer the person pressed Run on holds one of its roots (`knowledgeBridge.ts` `live`), or
 * when the `builderforce.knowledge.autoIndex` opt-in (default OFF) indexes every folder from
 * startup. The background indexer (`backgroundIndexer.ts`) and the index's save re-seed
 * (`index/activateKnowledgeIndex.ts`) both read this gate, and restart/stop as it changes.
 *
 * A root RUNS from its first `start` until a grace after its LAST `stop`: an `unlive` followed at
 * once by a new `live` (the view re-mounting) never stops the root's knowledge work. Listeners
 * (`onChange`) hear only the edges — a root becoming running, a root leaving its grace.
 */

import * as vscode from "vscode";
import { workspaceFolders } from "./knowledgeService";
import { pathKey, rootForPath, type KnowledgeRoot } from "./knowledgeRoots";

/** The `builderforce.knowledge.*` setting segment; `autoIndexOn` reads `${AUTO_INDEX_SETTING}` off it. */
export const AUTO_INDEX_SETTING = "knowledge.autoIndex";

/** A stopped root keeps running this long: a quick unlive→live never stops its knowledge work. */
export const STOP_GRACE_MS = 5_000;

/** The `builderforce.knowledge.autoIndex` opt-in (default OFF): every folder is indexed from startup. */
export function autoIndexOn(): boolean {
  return vscode.workspace.getConfiguration("builderforce").get<boolean>(AUTO_INDEX_SETTING, false);
}

/**
 * The folders a running root's id resolves to: every open workspace folder, so a running folder
 * root (`<folder id>`) and any sub-folder root (`<folder id>:<rel>`) inside it are both matched.
 * The autoIndex opt-in indexes every folder.
 */
function runningFolders(): string[] {
  if (autoIndexOn()) return workspaceFolders().map((f) => f.path);
  const folders = workspaceFolders();
  const held = new Set<string>();
  for (const id of visualizerSessions.runningRoots()) {
    for (const f of folders) {
      const root = rootForPath(f.path, folders);
      const folderId = root?.rootId ?? pathKey(f.path);
      if (id === folderId || id.startsWith(`${folderId}:`)) { held.add(f.path); break; }
    }
  }
  return [...held];
}

/** This folder is indexed while knowledge runs: the opt-in is on, or one of its roots runs. */
export function indexesFolder(root: KnowledgeRoot): boolean {
  return runningFolders().some((f) => pathKey(f) === pathKey(root.folderPath));
}

/** Knowledge runs for this absolute path: the opt-in is on, or it sits under a running root. */
export function knowledgeRunsAt(absPath: string): boolean {
  const target = pathKey(absPath);
  return runningFolders().some((f) => {
    const key = pathKey(f);
    return target === key || target.startsWith(`${key}/`);
  });
}

type SessionListener = (rootId: string, running: boolean) => void;

/**
 * The ONE registry of the roots the knowledge view is running. `start`/`stop` come from the
 * bridge's `live`/`unlive`; `stop` closes the root only after {@link STOP_GRACE_MS}, and a
 * `start` inside the grace cancels the close — so the root's knowledge work never stops for a
 * view that is only re-mounting. Listeners hear a root becoming running and leaving its grace.
 */
class VisualizerSessions {
  private readonly running = new Map<string, number>();   // rootId → live views
  private readonly stopping = new Map<string, ReturnType<typeof setTimeout>>(); // rootId → its grace timer
  private readonly listeners = new Set<SessionListener>();

  runningRoots(): string[] {
    // A stopped root is in `running` AND `stopping` through its grace: list it once.
    return [...new Set([...this.running.keys(), ...this.stopping.keys()])];
  }

  onChange(cb: SessionListener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  start(rootId: string): void {
    if (this.stopping.has(rootId)) { // a re-subscribe inside the grace: the root never stopped
      clearTimeout(this.stopping.get(rootId)!);
      this.stopping.delete(rootId);
      this.running.set(rootId, 1);
      return;
    }
    if (this.running.has(rootId)) { this.running.set(rootId, this.running.get(rootId)! + 1); return; }
    this.running.set(rootId, 1);
    this.emit(rootId, true);
  }

  stop(rootId: string): void {
    if (this.stopping.has(rootId)) return; // already closing: a stop without a (re-)start is ignored
    const left = (this.running.get(rootId) ?? 0) - 1;
    if (left > 0) { this.running.set(rootId, left); return; }
    if (!this.running.has(rootId)) return; // a stop without a start is ignored
    // The root stays `running` through the grace: a re-`start` inside it is a no-op (the close is cancelled),
    // and only the grace timer's expiry moves it out of `runningRoots` and tells listeners it stopped.
    this.stopping.set(rootId, setTimeout(() => {
      this.stopping.delete(rootId);
      this.running.delete(rootId);
      this.emit(rootId, false);
    }, STOP_GRACE_MS));
  }

  /** Resets every session and grace (the tests, one process per run). */
  reset(): void {
    for (const timer of this.stopping.values()) clearTimeout(timer);
    this.running.clear();
    this.stopping.clear();
    this.listeners.clear();
  }

  private emit(rootId: string, running: boolean): void {
    for (const cb of [...this.listeners]) {
      try { cb(rootId, running); } catch { /* a listener's failure never stops the sessions */ }
    }
  }
}

/** The singleton the bridge, the background indexer and the index re-seed all read. */
export const visualizerSessions = new VisualizerSessions();

/** The tests' reset: drops every running root, grace timer and listener. */
export function resetVisualizerSessions(): void {
  visualizerSessions.reset();
}

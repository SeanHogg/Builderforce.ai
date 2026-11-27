/**
 * `nodeWatchPort()` — the Node host's {@link WatchPort}: one recursive `fs.watch` per root,
 * shared by every subscriber of that root and closed with the last one. Watchers are keyed by the
 * root's REAL path, so the same folder reached through a link (or a different spelling) shares
 * one watcher: the gateway's code index and the definition index of one root ride a single
 * watcher. It ignores the indexes' own `.builderforce/` directory (their writes are not source
 * changes). The returned port is one process-wide instance.
 *
 * A watcher that errors cannot vouch for the tree any more: its subscribers are told the root
 * changed, and the watcher is re-created for them. When it cannot be re-created they are dropped
 * (and told), so none stays attached to a dead watcher and each re-subscribes on its own terms.
 */

import { realpathSync, watch, type FSWatcher } from "node:fs";
import * as path from "node:path";
import { isIndexStatePath, type WatchPort } from "./watch-port.js";

type Listener = (absPaths: string[]) => void;

interface RootWatch {
  watcher: FSWatcher;
  listeners: Set<Listener>;
}

const watches = new Map<string, RootWatch>();

/** The key a root is watched under: its real path, else its resolved path when it cannot be resolved. */
function watchKey(root: string): string {
  const resolved = path.resolve(root);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/** Open a watcher over `key` for `listeners`. Throws when the host cannot watch it. */
function openRootWatch(key: string, listeners: Set<Listener>): RootWatch {
  const emit = (absPaths: string[]): void => { for (const listener of [...listeners]) listener(absPaths); };
  const watcher = watch(key, { recursive: true, persistent: false }, (_event, file) => {
    const abs = file ? path.resolve(key, file.toString()) : key;
    if (!isIndexStatePath(key, abs)) emit([abs]);
  });
  const entry: RootWatch = { watcher, listeners };
  watcher.on("error", () => {
    watcher.close();
    if (watches.get(key) !== entry) return;
    watches.delete(key);
    // Tell everyone the tree can no longer be vouched for, then keep them watching when we can.
    emit([key]);
    if (listeners.size === 0) return;
    try {
      watches.set(key, openRootWatch(key, listeners));
    } catch {
      listeners.clear(); // dropped (and already told): a subscriber re-subscribes rather than hold a dead watcher
    }
  });
  return entry;
}

const port: WatchPort = {
  subscribe(root, onChange) {
    const key = watchKey(root);
    let entry = watches.get(key);
    if (!entry) {
      entry = openRootWatch(key, new Set());
      watches.set(key, entry);
    }
    const listeners = entry.listeners;
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
      const current = watches.get(key);
      if (current && current.listeners === listeners && listeners.size === 0) {
        watches.delete(key);
        current.watcher.close();
      }
    };
  },
};

/** The one process-wide Node change feed. */
export function nodeWatchPort(): WatchPort {
  return port;
}

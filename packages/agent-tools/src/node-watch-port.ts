/**
 * `nodeWatchPort()` — the Node host's {@link WatchPort}: one recursive `fs.watch` per root,
 * shared by every subscriber of that root and closed with the last one. It ignores the
 * indexes' own `.builderforce/` directory (their writes are not source changes). The
 * returned port is one process-wide instance, so the gateway's code index and the
 * definition index of the same root ride a single watcher.
 */

import { watch, type FSWatcher } from "node:fs";
import * as path from "node:path";
import { isIndexStatePath, type WatchPort } from "./watchPort.js";

interface RootWatch {
  watcher: FSWatcher;
  listeners: Set<(absPaths: string[]) => void>;
}

const watches = new Map<string, RootWatch>();

function openRootWatch(root: string): RootWatch {
  const listeners = new Set<(absPaths: string[]) => void>();
  const emit = (absPaths: string[]) => { for (const listener of [...listeners]) listener(absPaths); };
  const watcher = watch(root, { recursive: true, persistent: false }, (_event, file) => {
    const abs = file ? path.resolve(root, file.toString()) : root;
    if (!isIndexStatePath(root, abs)) emit([abs]);
  });
  // A watcher that failed can no longer vouch for the tree: report the root, then drop it.
  watcher.on("error", () => {
    watcher.close();
    if (watches.get(root)?.watcher === watcher) watches.delete(root);
    emit([root]);
  });
  return { watcher, listeners };
}

const port: WatchPort = {
  subscribe(root, onChange) {
    let entry = watches.get(root);
    if (!entry) {
      entry = openRootWatch(root);
      watches.set(root, entry);
    }
    const mine = entry;
    mine.listeners.add(onChange);
    return () => {
      mine.listeners.delete(onChange);
      if (mine.listeners.size === 0 && watches.get(root) === mine) {
        watches.delete(root);
        mine.watcher.close();
      }
    };
  },
};

/** The one process-wide Node change feed. */
export function nodeWatchPort(): WatchPort {
  return port;
}

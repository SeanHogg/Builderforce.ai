/**
 * `nodeWatchPort()` — the Node host's {@link WatchPort}: one recursive `fs.watch` per root,
 * shared by every subscriber of that root and closed with the last one. Watchers are keyed by the
 * root's REAL path, so the same folder reached through a link (or a different spelling) shares
 * one watcher: the gateway's code index and the definition index of one root ride a single
 * watcher. Each subscriber keeps the root it subscribed with, and every path is re-based onto it
 * before delivery — a root opened through a symlink/junction still receives paths under ITS root.
 * It ignores the indexes' own `.builderforce/` directory (their writes are not source
 * changes). The returned port is one process-wide instance.
 *
 * A watcher that errors cannot vouch for the tree any more: its subscribers are told the root
 * changed (the root path itself), and the watcher is re-created for them. When it cannot be
 * re-created they are dropped and told (`onLost`), so none stays attached to a dead watcher and
 * each re-subscribes on its own terms.
 */

import { realpathSync, watch, type FSWatcher } from "node:fs";
import * as path from "node:path";
import { isIndexStatePath, type WatchPort } from "./watch-port.js";

interface Subscriber {
  /** The root this subscriber asked for (resolved, not real-pathed): the base its paths are delivered under. */
  root: string;
  onChange: (absPaths: string[]) => void;
  onLost?: () => void;
}

interface RootWatch {
  watcher: FSWatcher;
  subscribers: Set<Subscriber>;
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

/** `abs` (under the watcher's `key`) re-based onto the subscriber's own `root`. */
function rebase(key: string, root: string, abs: string): string {
  const rel = path.relative(key, abs);
  if (!rel) return root;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return abs;
  return path.join(root, rel);
}

/** Open a watcher over `key` for `subscribers`. Throws when the host cannot watch it. */
function openRootWatch(key: string, subscribers: Set<Subscriber>): RootWatch {
  const emit = (absPaths: string[]): void => {
    for (const sub of [...subscribers]) sub.onChange(absPaths.map((abs) => rebase(key, sub.root, abs)));
  };
  const watcher = watch(key, { recursive: true, persistent: false }, (_event, file) => {
    const abs = file ? path.resolve(key, file.toString()) : key;
    if (!isIndexStatePath(key, abs)) emit([abs]);
  });
  const entry: RootWatch = { watcher, subscribers };
  watcher.on("error", () => {
    watcher.close();
    if (watches.get(key) !== entry) return;
    watches.delete(key);
    // Tell everyone the tree can no longer be vouched for, then keep them watching when we can.
    emit([key]);
    if (subscribers.size === 0) return;
    try {
      watches.set(key, openRootWatch(key, subscribers));
    } catch {
      // Dropped and told: a subscriber re-subscribes rather than hold a dead watcher.
      const lost = [...subscribers];
      subscribers.clear();
      for (const sub of lost) sub.onLost?.();
    }
  });
  return entry;
}

const port: WatchPort = {
  subscribe(root, onChange, onLost) {
    const key = watchKey(root);
    let entry = watches.get(key);
    if (!entry) {
      entry = openRootWatch(key, new Set());
      watches.set(key, entry);
    }
    const subscribers = entry.subscribers;
    const sub: Subscriber = { root: path.resolve(root), onChange, ...(onLost ? { onLost } : {}) };
    subscribers.add(sub);
    return () => {
      subscribers.delete(sub);
      const current = watches.get(key);
      if (current && current.subscribers === subscribers && subscribers.size === 0) {
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

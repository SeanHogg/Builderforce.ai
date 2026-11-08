/**
 * The browser's replica host: ONE `createReplicaHost` (agent-tools) per knowledge source, locked across tabs with the Web Locks
 * API. Only the tab holding `bf-knowledge-replica:<root>` pumps that root's queue (the pump asks `ifAvailable` and holds the lock
 * until it stops); a REVIEW takes the same lock in wait mode, so two tabs never write one root's queue at once. Where this tab's
 * own pump already holds the lock the review does not wait on it (the pump idles while a review runs, so waiting would deadlock).
 * Without `navigator.locks` the host falls back to agent-tools' file lock over the same `KnowledgeFiles`.
 */

import { createReplicaHost, fileReplicaLock, type ReplicaHost, type ReplicaLockPort } from '@builderforce/agent-tools/knowledge';
import type { KnowledgeDegradedReporter } from './directorySourceKit';

/** The slice of `LockManager` this uses (a test passes a fake). */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => Promise<void> | void): Promise<unknown>;
  request(name: string, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
}

export const replicaLockName = (rootId: string): string => `bf-knowledge-replica:${rootId}`;

export interface WebReplicaLock extends ReplicaLockPort {
  /** Runs `run` while holding the root's lock (waits for another tab's pump or review). */
  exclusive<T>(rootId: string, run: () => Promise<T>): Promise<T>;
}

export function webLocksReplicaLock(locks: LockManagerLike | undefined = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks): WebReplicaLock {
  if (!locks) {
    const file = fileReplicaLock();
    return { acquire: (files, rootId) => file.acquire(files, rootId), exclusive: (_rootId, run) => run() };
  }
  const heldHere = new Set<string>();
  return {
    acquire(_files, rootId) {
      return new Promise((resolve, reject) => {
        locks.request(replicaLockName(rootId), { ifAvailable: true }, (lock) => {
          if (!lock) { resolve(undefined); return; }
          return new Promise<void>((held) => {
            heldHere.add(rootId);
            let released = false;
            resolve({
              async release() {
                if (released) return;
                released = true;
                heldHere.delete(rootId);
                held();
              },
            });
          });
        }).catch(reject);
      });
    },
    exclusive(rootId, run) {
      if (heldHere.has(rootId)) return run();
      return locks.request(replicaLockName(rootId), run) as Promise<Awaited<ReturnType<typeof run>>>;
    },
  };
}

export interface BrowserReplica {
  host: ReplicaHost;
  /** `host.duringReview` with the review holding the root's cross-tab lock. */
  duringReview: ReplicaHost['duringReview'];
}

export function createBrowserReplica(onDegraded: KnowledgeDegradedReporter): BrowserReplica {
  const lock = webLocksReplicaLock();
  const host = createReplicaHost({ lock, report: (what, error) => onDegraded(what, error) });
  return {
    host,
    duringReview: (rootId, files, pump, run, opts) => host.duringReview(rootId, files, pump, () => lock.exclusive(rootId, run), opts),
  };
}

/**
 * The browser's replica host: ONE `createReplicaHost` (agent-tools) per knowledge source, locked across tabs with the Web Locks
 * API. Only the tab holding `bf-knowledge-replica:<root>` pumps that root's queue (the pump asks `ifAvailable` and holds the lock
 * until it stops); a REVIEW takes the same lock in wait mode, so two tabs never write one root's queue at once. Where this tab's
 * own pump already holds the lock the review joins it instead of waiting (the pump idles while a review runs, so waiting would
 * deadlock); the lock is requested once per tab and released only when the last in-tab holder (pump or review) leaves, and a pump
 * whose grant arrives while a review of that root is pending gives the lock up so the review proceeds.
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
  // The Web Lock per root is requested ONCE; every in-tab holder (pump or review) counts, and the lock is released only when the
  // last one lets go, so a pump that stops mid-review cannot free the root for another tab.
  const holders = new Map<string, { count: number; end: () => void }>();
  /** Reviews of a root that asked for the lock and are not holding it yet. */
  const wanting = new Map<string, number>();
  /** Registers one holder on a root's entry; the returned leave is idempotent and ends the Web Lock with the last holder. */
  const leaver = (rootId: string, entry: { count: number; end: () => void }): (() => void) => {
    let left = false;
    return () => {
      if (left) return;
      left = true;
      entry.count -= 1;
      if (entry.count > 0) return;
      if (holders.get(rootId) === entry) holders.delete(rootId);
      entry.end();
    };
  };
  return {
    acquire(_files, rootId) {
      return new Promise((resolve, reject) => {
        // A review of this root in this tab holds the lock: the pump stays out (it idles during a review anyway).
        if (holders.has(rootId)) { resolve(undefined); return; }
        locks.request(replicaLockName(rootId), { ifAvailable: true }, (lock) => {
          // A review of this root asked for the lock between this request and its grant: give it up so the review proceeds
          // (the pump would only idle behind it).
          if (!lock || (wanting.get(rootId) ?? 0) > 0) { resolve(undefined); return; }
          return new Promise<void>((end) => {
            const entry = { count: 1, end };
            holders.set(rootId, entry);
            const leave = leaver(rootId, entry);
            resolve({ async release() { leave(); } });
          });
        }).catch(reject);
      });
    },
    async exclusive(rootId, run) {
      const entry = holders.get(rootId);
      let leave: () => void;
      if (entry) {
        entry.count += 1;
        leave = leaver(rootId, entry);
      } else {
        wanting.set(rootId, (wanting.get(rootId) ?? 0) + 1);
        const stopWanting = (): void => {
          const n = (wanting.get(rootId) ?? 1) - 1;
          if (n > 0) wanting.set(rootId, n); else wanting.delete(rootId);
        };
        leave = await new Promise<() => void>((got, fail) => {
          locks.request(replicaLockName(rootId), () => new Promise<void>((end) => {
            stopWanting();
            const fresh = { count: 1, end };
            holders.set(rootId, fresh);
            got(leaver(rootId, fresh));
          })).catch((error) => { stopWanting(); fail(error); });
        });
      }
      try { return await run(); } finally { leave(); }
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

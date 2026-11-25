/**
 * The web sync lease: exactly ONE tab of this browser pushes at a time.
 *
 * Two layers, each doing the job only it can:
 *   - the Web Locks API (`navigator.locks`, `ifAvailable`) answers across TABS: a tab that
 *     cannot take the lock does not sync this round (`run` resolves undefined, as the
 *     coordinator expects), and the lock dies with its tab, so a closed or crashed holder
 *     never strands the queue;
 *   - the package's device-store coordinator lease answers within ONE tab and hands the run
 *     a FENCE, so a run that outlives its slot cannot commit and its requests abort.
 *
 * Why not `createIndexedDbSyncLease` (the `lease` on `WebLocalFirstStoreHandle`): that lease
 * holds the store's own partition lease for the whole run, and the coordinator then commits
 * through the SAME partition's `transact`, which waits on that lease — it would starve its
 * own writes. Where Web Locks are missing the in-tab lease alone is used.
 */

import { createDeviceStoreCoordinatorLease, type CoordinatorLeaseFence, type SyncLease } from '@builderforce/local-first';
import type { LeaseLockManager } from '@builderforce/local-first/indexed-db';

export interface WebSyncLeaseOptions {
  deviceId: string;
  /** Injectable for tests; `navigator.locks` by default. `null` forces the in-tab lease only. */
  locks?: LeaseLockManager | null;
  now?: () => number;
  ttlMs?: number;
}

function browserLocks(): LeaseLockManager | undefined {
  const locks = (globalThis as { navigator?: { locks?: Partial<LeaseLockManager> } }).navigator?.locks;
  return locks && typeof locks.request === 'function' ? (locks as LeaseLockManager) : undefined;
}

export function createWebSyncLease(options: WebSyncLeaseOptions): SyncLease {
  const inTab = createDeviceStoreCoordinatorLease({
    deviceStore: `web:${options.deviceId}`,
    now: options.now ?? Date.now,
    ttlMs: options.ttlMs ?? 30_000,
  });
  const locks = options.locks === undefined ? browserLocks() : options.locks ?? undefined;
  if (!locks) return inTab;
  const lockName = `builderforce-web-sync:${options.deviceId}`;
  return {
    run<R>(owner: string, work: (fence?: CoordinatorLeaseFence) => Promise<R>): Promise<R | undefined> {
      return new Promise<R | undefined>((resolve, reject) => {
        locks
          .request(lockName, { ifAvailable: true }, async (lock) => {
            if (!lock) {
              resolve(undefined);
              return;
            }
            try {
              resolve(await inTab.run(owner, work));
            } catch (error) {
              reject(error);
            }
          })
          .catch(reject);
      });
    },
  };
}

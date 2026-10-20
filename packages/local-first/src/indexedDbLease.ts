/**
 * Partition ownership lease for the IndexedDB adapter (G26).
 *
 * BUSY, NEVER A STEAL — AND NEVER BRICKED. One owner holds a lease per
 * partition while it works. A second owner is refused while that owner is
 * alive, however old its lease is (`leaseBusy`; `expiresAt` is diagnostic
 * only). What used to be missing is the other half: a tab that closed or
 * crashed mid-transaction left its row behind, and with nobody to release it
 * the store reported busy forever. A dead holder is now reclaimed — on PROOF of
 * death (`leaseReclaimable`), never on age:
 *
 *   - WEB LOCKS (every current browser). The holder takes the partition's Web
 *     Lock BEFORE it writes the row and drops it only after the row is gone.
 *     The browser releases a closed or crashed tab's Web Lock by itself. So a
 *     contender that has been GRANTED that lock knows any row still naming
 *     another owner belongs to a context that no longer holds it — dead.
 *     A contender that is not granted the lock is busy, full stop.
 *   - HEARTBEAT (no `navigator.locks`). The live holder refreshes
 *     `heartbeatAt` on the wall clock every `leaseHeartbeatMs`. A row is dead
 *     only when its heartbeat is older than `leaseStaleAfterMs` — a generous
 *     multiple (at least five minutes) that a throttled background tab still
 *     beats. A row written before heartbeats existed is judged by when it was
 *     acquired, the last moment it was known alive.
 *
 * The lease opens no network and imports no host. IndexedDB access is the
 * adapter's: this module is handed `open`.
 */

import { leaseBusy, leaseReclaimable, type HolderLiveness } from './durabilityContract.js';
import { idbRequest, trackComplete } from './idbTransaction.js';

export const LEASES_STORE = 'leases';

export interface LeaseRow {
  id: string;
  owner: string;
  acquiredAt: number;
  /** Diagnostic only. Never a steal window. */
  expiresAt: number;
  /** Wall-clock refresh by the LIVE holder. Absent on rows from older builds. */
  heartbeatAt?: number;
}

/** The slice of the Web Locks API the lease uses (`navigator.locks`). */
export interface LeaseLockManager {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
}

/** Minimum refresh interval for the heartbeat fallback. */
export const LEASE_HEARTBEAT_MIN_MS = 1_000;
/** A heartbeat this many refresh intervals old is a dead holder. */
export const LEASE_STALE_MULTIPLE = 30;
/** Never call a holder dead sooner than this, whatever `leaseMs` says. */
export const LEASE_STALE_MIN_MS = 5 * 60_000;

export function leaseHeartbeatMs(leaseMs: number): number {
  return Math.max(LEASE_HEARTBEAT_MIN_MS, Math.floor(leaseMs / 3));
}

export function leaseStaleAfterMs(leaseMs: number): number {
  return Math.max(LEASE_STALE_MIN_MS, leaseHeartbeatMs(leaseMs) * LEASE_STALE_MULTIPLE);
}

/** `navigator.locks` when this context has it. */
export function defaultLeaseLockManager(): LeaseLockManager | undefined {
  const locks = (globalThis as { navigator?: { locks?: Partial<LeaseLockManager> } }).navigator?.locks;
  return locks && typeof locks.request === 'function' ? (locks as LeaseLockManager) : undefined;
}

/**
 * What a contender can prove about a row that names another owner.
 * Holding the partition's Web Lock is proof; otherwise only a heartbeat that
 * stopped long ago is.
 */
export function leaseRowLiveness(
  row: Pick<LeaseRow, 'heartbeatAt' | 'acquiredAt'>,
  evidence: { webLockHeld: boolean; wallNow: number; staleAfterMs: number },
): HolderLiveness {
  if (evidence.webLockHeld) return 'dead';
  const lastSeen = typeof row.heartbeatAt === 'number' ? row.heartbeatAt : row.acquiredAt;
  if (typeof lastSeen !== 'number' || !Number.isFinite(lastSeen)) return 'unknown';
  return evidence.wallNow - lastSeen > evidence.staleAfterMs ? 'dead' : 'alive';
}

/** Ask for the lock without waiting. Resolves to its release, or undefined when another context holds it. */
function tryWebLock(locks: LeaseLockManager, name: string): Promise<(() => void) | undefined> {
  return new Promise((resolve, reject) => {
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    locks
      .request(name, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(undefined);
          return;
        }
        resolve(release);
        await held;
      })
      .catch(reject);
  });
}

export interface PartitionLeaseOptions {
  open(): Promise<IDBDatabase>;
  leaseKey: string;
  /** Web Lock name. Must be unique per database AND partition. */
  lockName: string;
  owner: string;
  now(): number;
  leaseMs: number;
  /** `null` turns Web Locks off (tests, contexts without them). */
  locks?: LeaseLockManager | null;
  staleAfterMs?: number;
  /** A heartbeat or release write failed. Never swallowed. */
  onError(error: unknown): void;
}

export interface PartitionLease {
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
  owner(): Promise<LeaseRow | undefined>;
}

export function createPartitionLease(options: PartitionLeaseOptions): PartitionLease {
  const locks = options.locks === undefined ? defaultLeaseLockManager() : options.locks ?? undefined;
  const staleAfterMs = options.staleAfterMs ?? leaseStaleAfterMs(options.leaseMs);
  const heartbeatMs = leaseHeartbeatMs(options.leaseMs);
  let releaseWebLock: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const dropWebLock = (): void => {
    const drop = releaseWebLock;
    releaseWebLock = undefined;
    drop?.();
  };

  /** Rewrite our own row, only while it is still ours. */
  const casOwnRow = async (mutate: (store: IDBObjectStore, row: LeaseRow) => void): Promise<void> => {
    const db = await options.open();
    const tx = db.transaction(LEASES_STORE, 'readwrite');
    const tracked = trackComplete(tx);
    const store = tx.objectStore(LEASES_STORE);
    await new Promise<void>((resolve, reject) => {
      const req = store.get(options.leaseKey);
      req.onsuccess = () => {
        const current = req.result as LeaseRow | undefined;
        if (current?.owner === options.owner) mutate(store, current);
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('indexeddb_lease_read_failed'));
    });
    await tracked;
  };

  const startHeartbeat = (): void => {
    heartbeat = setInterval(() => {
      casOwnRow((store, row) => {
        store.put({ ...row, heartbeatAt: Date.now(), expiresAt: options.now() + options.leaseMs } satisfies LeaseRow);
      }).catch((error: unknown) => options.onError(error));
    }, heartbeatMs);
    (heartbeat as { unref?: () => void }).unref?.();
  };

  const stopHeartbeat = (): void => {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  };

  /**
   * One compare-and-set on the lease row, issued inside the transaction so the
   * read and the write cannot drift apart. Another owner's row is busy unless
   * `leaseReclaimable` says its holder is provably dead.
   */
  const casAcquire = async (webLockHeld: boolean): Promise<boolean> => {
    const db = await options.open();
    const tx = db.transaction(LEASES_STORE, 'readwrite');
    const tracked = trackComplete(tx);
    const store = tx.objectStore(LEASES_STORE);
    const acquired = await new Promise<boolean>((resolve, reject) => {
      const req = store.get(options.leaseKey);
      req.onsuccess = () => {
        const current = req.result as LeaseRow | undefined;
        if (current && leaseBusy(current.owner) && current.owner !== options.owner) {
          const liveness = leaseRowLiveness(current, { webLockHeld, wallNow: Date.now(), staleAfterMs });
          if (!leaseReclaimable(current.owner, liveness)) {
            resolve(false);
            tx.abort();
            return;
          }
        }
        const acquiredAt = options.now();
        store.put({
          id: options.leaseKey,
          owner: options.owner,
          acquiredAt,
          expiresAt: acquiredAt + options.leaseMs,
          heartbeatAt: Date.now(),
        } satisfies LeaseRow);
        resolve(true);
      };
      req.onerror = () => reject(req.error ?? new Error('indexeddb_lease_read_failed'));
    });
    if (acquired) await tracked;
    return acquired;
  };

  return {
    async tryAcquire() {
      if (locks && !releaseWebLock) {
        releaseWebLock = await tryWebLock(locks, options.lockName);
        if (!releaseWebLock) return false;
      }
      let acquired = false;
      try {
        acquired = await casAcquire(releaseWebLock !== undefined);
      } finally {
        if (!acquired) dropWebLock();
      }
      if (acquired) startHeartbeat();
      return acquired;
    },
    /** Releases only this owner's row, then its Web Lock. A failure is reported, never masks the caller's result. */
    async release() {
      stopHeartbeat();
      try {
        await casOwnRow((store) => store.delete(options.leaseKey));
      } catch (error) {
        // The row outlives this call. Other owners stay busy until this context
        // dies (Web Lock released) or its heartbeat goes stale — the safe direction.
        options.onError(error);
      } finally {
        dropWebLock();
      }
    },
    async owner() {
      const db = await options.open();
      const tx = db.transaction(LEASES_STORE, 'readonly');
      const tracked = trackComplete(tx);
      const row = await idbRequest(tx.objectStore(LEASES_STORE).get(options.leaseKey) as IDBRequest<LeaseRow | undefined>);
      await tracked;
      return row;
    },
  };
}

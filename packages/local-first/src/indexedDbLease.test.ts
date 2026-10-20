/**
 * Dead-holder reclamation for the IndexedDB lease (G26): a closed or crashed tab
 * must not leave the store busy forever, and a LIVE holder must never be stolen
 * from — reclaim needs proof of death, never age.
 */
import { indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedDbLocalFirstStore } from './indexedDb.js';
import { leaseRowLiveness, leaseStaleAfterMs, LEASE_STALE_MIN_MS, type LeaseLockManager } from './indexedDbLease.js';

const name = (label: string): string => `lease-${label}-${crypto.randomUUID()}`;
const fast = { busyTimeoutMs: 60, busyPollMs: 5 };

/** An in-process Web Locks double: one holder per name, released when the callback settles. */
function fakeLocks(): LeaseLockManager {
  const held = new Set<string>();
  return {
    async request(lockName, _options, callback) {
      if (held.has(lockName)) return callback(null);
      held.add(lockName);
      try {
        return await callback({ name: lockName });
      } finally {
        held.delete(lockName);
      }
    },
  };
}

/** Write a lease row as a tab that has since died would have left it. */
async function plantLease(dbName: string, row: Record<string, unknown>): Promise<void> {
  const opener = createIndexedDbLocalFirstStore({ indexedDB, dbName, locks: null });
  await opener.export();
  opener.close();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('leases', 'readwrite');
    tx.objectStore('leases').put({ id: 'store:default', ...row });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('IndexedDB lease: provable-dead reclamation', () => {
  it('reclaims a crashed holder whose heartbeat stopped long ago (no Web Locks)', async () => {
    const dbName = name('stale-heartbeat');
    const longAgo = Date.now() - (LEASE_STALE_MIN_MS + 60_000);
    await plantLease(dbName, { owner: 'crashed-tab', acquiredAt: longAgo, expiresAt: longAgo + 10_000, heartbeatAt: longAgo });

    const store = createIndexedDbLocalFirstStore({ indexedDB, dbName, locks: null, ...fast });
    await expect(store.transact(async () => 'written')).resolves.toBe('written');
    expect(await store.leaseOwner()).toBeUndefined();
    store.close();
  });

  it('keeps a holder with a fresh heartbeat busy, however old its lease is (no Web Locks)', async () => {
    const dbName = name('fresh-heartbeat');
    await plantLease(dbName, { owner: 'live-tab', acquiredAt: 1, expiresAt: 2, heartbeatAt: Date.now() });

    const store = createIndexedDbLocalFirstStore({ indexedDB, dbName, locks: null, ...fast });
    await expect(store.transact(async () => undefined)).rejects.toThrow('local_first_store_busy');
    expect((await store.leaseOwner())?.owner).toBe('live-tab');
    store.close();
  });

  it('reclaims a holder-less row left by a create that never finished', async () => {
    const dbName = name('null-holder');
    await plantLease(dbName, { owner: '', acquiredAt: Date.now(), expiresAt: Date.now() });

    const store = createIndexedDbLocalFirstStore({ indexedDB, dbName, locks: null, ...fast });
    await expect(store.transact(async () => 'ok')).resolves.toBe('ok');
    store.close();
  });

  it('reclaims a row whose tab released its Web Lock, even with a fresh heartbeat', async () => {
    const dbName = name('web-lock-released');
    // The tab wrote its row and was closed: the browser dropped its Web Lock.
    await plantLease(dbName, { owner: 'closed-tab', acquiredAt: Date.now(), expiresAt: Date.now() + 10_000, heartbeatAt: Date.now() });

    const store = createIndexedDbLocalFirstStore({ indexedDB, dbName, locks: fakeLocks(), ...fast });
    await expect(store.transact(async () => 'ok')).resolves.toBe('ok');
    store.close();
  });

  it('never takes the lease from a live holder that still holds its Web Lock', async () => {
    const dbName = name('web-lock-live');
    const locks = fakeLocks();
    const first = createIndexedDbLocalFirstStore({ indexedDB, dbName, ownerId: 'tab-a', locks, ...fast });
    const second = createIndexedDbLocalFirstStore({ indexedDB, dbName, ownerId: 'tab-b', locks, ...fast });

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = first.withLease(() => held);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(second.transact(async () => undefined)).rejects.toThrow('local_first_store_busy');
    expect((await second.leaseOwner())?.owner).toContain('tab-a');

    release();
    await running;
    await expect(second.transact(async () => 'after')).resolves.toBe('after');
    first.close();
    second.close();
  });

  it('judges liveness by evidence, not age', () => {
    const staleAfterMs = leaseStaleAfterMs(10_000);
    expect(staleAfterMs).toBeGreaterThanOrEqual(LEASE_STALE_MIN_MS);
    const wallNow = 10_000_000;
    expect(leaseRowLiveness({ acquiredAt: 0, heartbeatAt: wallNow - 1_000 }, { webLockHeld: false, wallNow, staleAfterMs })).toBe('alive');
    expect(leaseRowLiveness({ acquiredAt: 0, heartbeatAt: wallNow - staleAfterMs - 1 }, { webLockHeld: false, wallNow, staleAfterMs })).toBe('dead');
    expect(leaseRowLiveness({ acquiredAt: wallNow, heartbeatAt: wallNow }, { webLockHeld: true, wallNow, staleAfterMs })).toBe('dead');
    // A pre-heartbeat row is judged by when it was last known alive.
    expect(leaseRowLiveness({ acquiredAt: wallNow - 1_000 }, { webLockHeld: false, wallNow, staleAfterMs })).toBe('alive');
  });
});

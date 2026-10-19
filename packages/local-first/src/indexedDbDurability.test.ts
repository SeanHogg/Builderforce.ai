/**
 * G26 — the IndexedDB adapter's own durability contract.
 *
 * These tests drive the real adapter over `fake-indexeddb`, not a stand-in, and
 * they cover the four properties the browser half of the ticket owes its host:
 * a crash-safe write, a busy timeout instead of a lock steal, a corrupt-store
 * recovery path, and a stated redaction rule — plus multi-tab ownership proved
 * on THIS adapter rather than on a helper.
 *
 * Every test uses its own database name, so the suite can run in any order and
 * beside the other IndexedDB test.
 */

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  createIndexedDbLocalFirstStore,
  INDEXEDDB_REDACTED_KEYS,
  INDEXEDDB_REDACTION_RULE,
  redactSnapshotForUploadOrLog,
  type IndexedDbLocalFirstStore,
} from './indexedDb.js';
import { newLocalRecord, type LocalFirstSnapshot } from './store.js';

const SNAPSHOTS = 'snapshots';
const LEASES = 'leases';
const STAGED = 'staged';

/** A fresh factory per test: no shared database, no cross-test ordering. */
const factory = (): IDBFactory => new IDBFactory();

const options = (
  name: string,
  overrides: Partial<Parameters<typeof createIndexedDbLocalFirstStore>[0]> = {},
) => ({
  indexedDB: factory(),
  dbName: name,
  partition: 'unbound',
  ...overrides,
});

const dbName = (label: string): string => `local-first-durability-${label}-${crypto.randomUUID()}`;

const ticket = (title: string, extra: Record<string, unknown> = {}) =>
  newLocalRecord({
    id: crypto.randomUUID(),
    entityType: 'ticket',
    payload: { title, ...extra },
    deviceId: 'device-a',
  });

const putTicket = async (store: IndexedDbLocalFirstStore, record: ReturnType<typeof ticket>): Promise<void> => {
  await store.transact(async (tx) => {
    await tx.put(record);
  });
};

/** Raw row access, so a test can plant a crash or corruption the API forbids. */
const rawRows = async (
  db: IDBFactory,
  name: string,
  storeName: string,
  key = 'unbound',
): Promise<Array<Record<string, unknown>> | undefined> =>
  new Promise((resolve, reject) => {
    const req = db.open(name, 2);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve(undefined);
        return;
      }
      const tx = db.transaction(storeName, 'readonly');
      const all = tx.objectStore(storeName).getAll();
      all.onsuccess = () => {
        const rows = (all.result as Array<Record<string, unknown>>).filter(
          (row) => row.id === key || storeName === LEASES,
        );
        db.close();
        resolve(rows);
      };
      all.onerror = () => reject(all.error);
    };
    req.onerror = () => reject(req.error);
  });

/** Open the database at schema v2 and write a row directly. */
const plantRow = async (
  db: IDBFactory,
  name: string,
  storeName: string,
  value: Record<string, unknown>,
  key = 'unbound',
): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = db.open(name, 2);
    req.onupgradeneeded = () => {
      const upgrading = req.result;
      if (!upgrading.objectStoreNames.contains(SNAPSHOTS)) {
        upgrading.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
      }
      if (!upgrading.objectStoreNames.contains(LEASES)) upgrading.createObjectStore(LEASES, { keyPath: 'id' });
      if (!upgrading.objectStoreNames.contains(STAGED)) upgrading.createObjectStore(STAGED, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const open = req.result;
      const tx = open.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put({ id: key, ...value });
      tx.oncomplete = () => {
        open.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

describe('IndexedDB adapter durability (G26)', () => {
  it('promotes a staged write so a crash between the two halves still lands', async () => {
    const name = dbName('crash');
    const db = factory();
    const first = createIndexedDbLocalFirstStore({ ...options(name), indexedDB: db });
    const good = ticket('committed before the crash');
    await putTicket(first, good);
    first.close();

    // A process that died between the stage write and the promote: the staged
    // row is on disk, the live row still holds the previous good snapshot.
    const next = ticket('staged, never promoted');
    await plantRow(db, name, STAGED, { value: snapshotWith([next]), writtenAt: Date.now(), stagedAt: Date.now() });
    const stagedBefore = await rawRows(db, name, STAGED);
    expect(stagedBefore).toHaveLength(1);

    const recovered = createIndexedDbLocalFirstStore({ ...options(name), indexedDB: db });
    expect((await recovered.read((tx) => tx.get('ticket', next.id)))?.payload).toEqual({ title: 'staged, never promoted' });
    // The promoted snapshot is now the live one, and no staged row is left behind.
    expect(await rawRows(db, name, STAGED)).toHaveLength(0);
    const live = await rawRows(db, name, SNAPSHOTS);
    expect(live?.[0]?.id).toBe('unbound');
    recovered.close();
  });

  it('keeps the previous good snapshot when a staged row is corrupt', async () => {
    const name = dbName('corrupt-staged');
    const db = factory();
    const first = createIndexedDbLocalFirstStore({ ...options(name), indexedDB: db });
    const good = ticket('the snapshot to keep');
    await putTicket(first, good);
    first.close();

    await plantRow(db, name, STAGED, { value: { records: 'not-an-array' }, writtenAt: Date.now(), stagedAt: Date.now() });

    const recovered = createIndexedDbLocalFirstStore({ ...options(name), indexedDB: db });
    // The parse that failed must never replace the previous good copy.
    expect((await recovered.read((tx) => tx.get('ticket', good.id)))?.payload).toEqual({ title: 'the snapshot to keep' });
    expect(await rawRows(db, name, STAGED)).toHaveLength(0);
    recovered.close();
  });

  it('reports a corrupt live snapshot that has nothing to recover from', async () => {
    const name = dbName('corrupt-live');
    const db = factory();
    await plantRow(db, name, SNAPSHOTS, { value: { records: null }, writtenAt: Date.now() });

    const store = createIndexedDbLocalFirstStore({ ...options(name), indexedDB: db });
    await expect(store.export()).rejects.toThrow('local_first_snapshot_corrupt');
    // A corrupt store must not be papered over with an empty, fake snapshot.
    await expect(store.export()).rejects.toThrow('local_first_snapshot_corrupt');
    store.close();
  });

  it('waits its turn instead of stealing the lease, then takes it once released', async () => {
    const name = dbName('busy');
    const db = factory();
    const first = createIndexedDbLocalFirstStore({ ...options(name, { indexedDB: db, busyTimeoutMs: 2_000 }), ownerId: 'tab-a' });
    const second = createIndexedDbLocalFirstStore({ ...options(name, { indexedDB: db, busyTimeoutMs: 2_000 }), ownerId: 'tab-b' });

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = first.withLease(() => held);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The contender must WAIT for the holder, not take the lock.
    const contender = second.withLease(async () => 'second-ran');
    await new Promise((resolve) => setTimeout(resolve, 150));
    let settled = false;
    void contender.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    release();
    await running;
    expect(await contender).toBe('second-ran');
    first.close();
    second.close();
  });

  it('reports busy after the timeout and never steals a lease held far past its expiry', async () => {
    const name = dbName('steal');
    const db = factory();
    // A clock far past the lease's own expiry: age must not admit a second owner.
    let clock = 1_000;
    const now = () => {
      clock += 60_000;
      return clock;
    };
    const first = createIndexedDbLocalFirstStore({
      ...options(name, { indexedDB: db, now, leaseMs: 1, busyTimeoutMs: 60, busyPollMs: 5 }),
      ownerId: 'tab-a',
    });
    const second = createIndexedDbLocalFirstStore({
      ...options(name, { indexedDB: db, now, leaseMs: 1, busyTimeoutMs: 60, busyPollMs: 5 }),
      ownerId: 'tab-b',
    });

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = first.withLease(() => held);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Many lease lifetimes have passed. The lease is still held by tab-a.
    await expect(second.transact(async () => undefined)).rejects.toThrow('local_first_store_busy');
    const holder = await second.leaseOwner();
    expect(holder?.owner).toContain('tab-a');

    release();
    await running;
    first.close();
    second.close();
  });

  it('serializes two tabs: a record and its journal event commit together', async () => {
    const name = dbName('multi-tab');
    const db = factory();
    const tabA = createIndexedDbLocalFirstStore({ ...options(name, { indexedDB: db }), ownerId: 'tab-a' });
    const tabB = createIndexedDbLocalFirstStore({ ...options(name, { indexedDB: db }), ownerId: 'tab-b' });

    const record = ticket('one commit, two rows');
    await tabA.transact(async (tx) => {
      await tx.put(record);
      await tx.append({
        eventId: crypto.randomUUID(),
        clientEntityId: record.id,
        entityType: record.entityType,
        operation: 'create',
        schemaVersion: 1,
        occurredAt: record.occurredAt,
        dependsOn: [],
        destination: record.destination,
        payload: record.payload,
      });
    });

    // The other tab reads the committed state — reads are not served stale.
    expect((await tabB.read((tx) => tx.get('ticket', record.id)))?.payload).toEqual({ title: 'one commit, two rows' });
    expect(await tabB.read((tx) => tx.pending())).toHaveLength(1);

    // And it can take the lease now that tab-a released it.
    const lease = await createIndexedDbLocalFirstStore({ ...options(name, { indexedDB: db }), ownerId: 'tab-b' }).leaseOwner();
    expect(lease).toBeUndefined();
    tabA.close();
    tabB.close();
  });

  it('strips secret-shaped keys from the only value eligible to leave the device', async () => {
    const name = dbName('redaction');
    const store = createIndexedDbLocalFirstStore(options(name));
    const record = ticket('Redaction rule', {
      accessToken: 'secret-token',
      nested: { client_secret: 'secret-value', sessionCookie: 'sid=1', note: 'kept' },
    });
    await store.transact(async (tx) => {
      await tx.put(record);
    });

    const local = await store.export();
    expect(JSON.stringify(local)).toContain('secret-token');

    const uploadable = await store.exportForUploadOrLog();
    expect(JSON.stringify(uploadable)).not.toContain('secret-token');
    expect(JSON.stringify(uploadable)).not.toContain('secret-value');
    const payload = uploadable.records[0]?.payload as Record<string, unknown>;
    expect(payload.accessToken).toBeUndefined();
    expect(payload.nested).toEqual({ note: 'kept' });
    expect(payload.title).toBe('Redaction rule');

    // The rule is stated, not implied.
    expect(INDEXEDDB_REDACTED_KEYS).toContain('token');
    expect(INDEXEDDB_REDACTION_RULE).toMatch(/upload/i);
    expect(INDEXEDDB_REDACTION_RULE).toMatch(/exportForUploadOrLog/);
    expect(redactSnapshotForUploadOrLog({ note: 'kept', apiKey: 'x' })).toEqual({ note: 'kept' });
    store.close();
  });
});

/** Build a valid snapshot containing `records`, for planting in the raw store. */
function snapshotWith(records: ReturnType<typeof ticket>[]): LocalFirstSnapshot {
  return {
    records,
    events: [],
    mappings: [],
    receipts: [],
    conflicts: [],
    cursors: {},
    nextSequence: records.length + 1,
  };
}
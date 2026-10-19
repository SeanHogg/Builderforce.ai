/**
 * G26 (web host): the four durability properties the browser owes a user whose
 * work was filed offline, asserted against the store the web app really uses.
 *
 * This is a CONTRACT test for the host's obligations, not a re-implementation:
 * the lease, the staged/promote commit and the validation all live in
 * `@builderforce/local-first/indexed-db`. What is pinned here is that the web
 * host states the rules (`./durability`), reports the real state when a write
 * fails, and never converts a fault into a fake success:
 *
 *   1. BUSY TIMEOUT, NOT LOCK STEAL — a second owner of the same database polls
 *      for `WEB_SNAPSHOT_BUSY_TIMEOUT` and then fails `local_first_store_busy`.
 *      It never takes the live lease, and no age releases one.
 *   2. CORRUPT IS NOT EMPTY — a snapshot row that fails validation raises
 *      `local_first_snapshot_corrupt`; the host classifies it `corrupt` and
 *      returns no store, never `{}`.
 *   3. RECOVERY DROPS SECRETS — a secret planted in the payload does not
 *      survive into anything the host could upload or log.
 *   4. DURABLE ACROSS RELOAD — a fresh store object reopened on the same
 *      database returns both ordered events, their destination binding and the
 *      pending batch.
 *
 * Runs in the `node` environment (src/lib/**). `fake-indexeddb` is INJECTED
 * through the adapter's `indexedDB` option rather than installed as a global, so
 * each test owns its database and nothing leaks between them.
 */
import { indexedDB as fakeIndexedDb } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  UNBOUND_DESTINATION,
  destinationKey,
  type EntityDestination,
  type LocalRecord,
} from '@builderforce/local-first';
import {
  createIndexedDbLocalFirstStore,
  type IndexedDbLocalFirstStore,
} from '@builderforce/local-first/indexed-db';
import {
  WEB_BUSY_ERROR,
  WEB_CORRUPT_ERROR,
  WEB_SNAPSHOT_BUSY_TIMEOUT,
  WEB_SNAPSHOT_REDACTED_KEYS,
  WEB_SNAPSHOT_REDACTION_NOTE,
  classifyWebStoreFailure,
  redactWebSnapshotForUploadOrLog,
  webSecondWindowMayStealLock,
} from './durability';
import { createLocalWorkManagement } from './workManagement';
import { openWebLocalFirstStore } from './store';

/**
 * A `LocalRecord` written straight into a transaction, with the fields the
 * store requires (`id` and `entityType`) and the rest left to the caller.
 * Keeping this as a function means no field can be quietly widened: the shape
 * is declared in one place and every record in this file goes through it.
 */
function record(entityType: 'project' | 'ticket', id: string, payload: unknown): LocalRecord {
  return {
    id,
    entityType,
    schemaVersion: 1,
    version: 1,
    destination: BOUND,
    occurredAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    payload,
  } as unknown as LocalRecord;
}

/** A private database per test, so a leaked lease cannot fail the next one. */
function dbName(label: string): string {
  return `g26-web-${label}-${crypto.randomUUID()}`;
}

/** A destination the web app would really be signed into. */
const BOUND: EntityDestination = {
  kind: 'bound',
  platformInstance: 'builderforce.ai',
  accountId: 'acct-web-1',
  tenantId: 'tenant-web-1',
  projectId: 'proj-web-1',
};

const PARTITION = destinationKey(BOUND);

/** Open the shared adapter over `name`, with a REAL owner id, always. */
function openStore(
  name: string,
  ownerId: string,
  overrides: { busyTimeoutMs?: number; busyPollMs?: number; partition?: string; leaseMs?: number; now?: () => number } = {},
): IndexedDbLocalFirstStore {
  return createIndexedDbLocalFirstStore({
    indexedDB: fakeIndexedDb,
    dbName: name,
    partition: overrides.partition ?? PARTITION,
    ownerId,
    busyTimeoutMs: overrides.busyTimeoutMs,
    busyPollMs: overrides.busyPollMs,
    leaseMs: overrides.leaseMs,
    now: overrides.now,
  });
}

/** Write a raw row into an object store, for the corrupt-snapshot cases. */
function plantRow(
  factory: IDBFactory,
  name: string,
  storeName: string,
  row: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, 2);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('leases')) db.createObjectStore('leases', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('staged')) db.createObjectStore('staged', { keyPath: 'id' });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(storeName, 'readwrite');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.objectStore(storeName).put(row);
    };
  });
}

/** Read a raw row back, so a recovery decision can be inspected. */
function readRow(
  factory: IDBFactory,
  name: string,
  storeName: string,
  key: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, 2);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  });
}

describe('G26 web durability: busy timeout, never a lock steal', () => {
  it('states the shared busy timeout instead of a millisecond steal window', () => {
    // 30_000 was the VSIX lock-steal window. If it ever reappears here, the
    // second owner would be admitted after 30s of waiting.
    expect(WEB_SNAPSHOT_BUSY_TIMEOUT).toBe(1_500);
    expect(WEB_SNAPSHOT_BUSY_TIMEOUT).not.toBe(30_000);
    expect(typeof WEB_SNAPSHOT_BUSY_TIMEOUT).toBe('number');
  });

  it('fails the second owner with a busy error instead of taking a live lease', async () => {
    const name = dbName('busy');
    const holder = createIndexedDbLocalFirstStore({
      indexedDB: fakeIndexedDb, dbName: name, partition: PARTITION, ownerId: 'tab-a',
    });
    const contender = createIndexedDbLocalFirstStore({
      indexedDB: fakeIndexedDb, dbName: name, partition: PARTITION, ownerId: 'tab-b',
      busyTimeoutMs: 60, busyPollMs: 10,
    });
    try {
      // tab-a holds the partition for as long as its lease work runs.
      await holder.withLease(async () => {
        // The live holder is NAMED. A missing holder reads as free, which is
        // why every lease call in this suite passes a real owner id. The store
        // namespaces the id (`ownerId:nonce`) so two stores of the same tab are
        // still distinct owners — assert the tab identity, not the raw string.
        const owner = await holder.leaseOwner();
        expect(owner?.owner).toBeTruthy();
        expect(owner?.owner).toMatch(/^tab-a:/);
        expect(owner?.owner).not.toMatch(/^tab-b/);

        // tab-b polls for its timeout and gives up. It must THROW the busy
        // error — resolving undefined would be a silent "no such work".
        await expect(contender.withLease(async () => 'tab-b-wrote')).rejects.toThrow(WEB_BUSY_ERROR);

        // And it must not have taken the lease: tab-a is still the holder, and
        // it is the SAME row — not a fresh one written by the contender.
        const still = await holder.leaseOwner();
        expect(still?.owner).toBe(owner?.owner);
        expect(still?.acquiredAt).toBe(owner?.acquiredAt);
      });

      // Once tab-a RELEASES, the same tab-b acquires. Busy is not a permanent
      // wedge — a steal is not the only way to make progress either.
      expect(await contender.withLease(async () => 'tab-b-wrote')).toBe('tab-b-wrote');
    } finally {
      holder.close();
      contender.close();
    }
  });

  it('never lets age — including a far-past lease — release a live lease', async () => {
    // The lease row's expiresAt is diagnostic only. A holder that outlives it
    // stays busy, which is the whole point: no second writer, ever.
    expect(webSecondWindowMayStealLock(30_000, 'tab-a')).toBe(false);
    expect(webSecondWindowMayStealLock(30 * 60 * 1000, 'tab-a')).toBe(false);
    expect(webSecondWindowMayStealLock(Number.MAX_SAFE_INTEGER, 'tab-a')).toBe(false);
    // Age is not the only thing refused: a missing holder is not a grant either.
    expect(webSecondWindowMayStealLock(0, undefined)).toBe(false);
    expect(webSecondWindowMayStealLock(0, '')).toBe(false);

    // Prove it on the real store: a holder whose clock is already an hour past
    // the lease term still refuses a second owner.
    const name = dbName('aged');
    let clock = 1_000_000;
    const holder = openStore(name, 'tab-a', { leaseMs: 1_000, now: () => clock });
    const contender = openStore(name, 'tab-b', {
      busyTimeoutMs: 40, busyPollMs: 10, leaseMs: 1_000, now: () => clock,
    });
    try {
      await holder.withLease(async () => {
        const before = await holder.leaseOwner();
        // One hour on an injected clock — far past the 1s lease term. The
        // adapter measures its busy deadline on the REAL clock too, so this
        // still terminates; what it must not do is treat the lease as expired.
        clock += 3_600_000;
        await expect(contender.withLease(async () => 'stolen')).rejects.toThrow(WEB_BUSY_ERROR);
        const after = await holder.leaseOwner();
        expect(after?.owner).toBe(before?.owner);
        // The diagnostic expiresAt IS in the past — and the lease is still held.
        expect(after?.expiresAt).toBeLessThan(clock);
      });
    } finally {
      holder.close();
      contender.close();
    }
  });
});

describe('G26 web durability: corrupt is not empty', () => {
  it('raises local_first_snapshot_corrupt for a live row that does not validate', async () => {
    const name = dbName('corrupt-live');
    const store = createIndexedDbLocalFirstStore({
      indexedDB: fakeIndexedDb, dbName: name, partition: PARTITION, ownerId: 'tab-a',
    });
    try {
      // A row that parses as JSON but is not a snapshot: no records array.
      await plantRow(fakeIndexedDb, name, 'snapshots', {
        id: PARTITION,
        value: { note: 'truncated', records: 'not-an-array' },
        writtenAt: 1,
      });
      await expect(store.export()).rejects.toThrow(WEB_CORRUPT_ERROR);
    } finally {
      store.close();
    }
  });

  it('reports a corrupt database as corrupt, never as an empty durable store', async () => {
    const name = dbName('corrupt-boot');
    // Write the bad row through a real store so the schema/version is right,
    // then plant the corruption directly over it.
    const seed = openStore(name, 'tab-a');
    await seed.transact(async (tx) => {
      await tx.put(record('project', 'p-1', { name: 'Real work' }));
    });
    seed.close();
    await plantRow(fakeIndexedDb, name, 'snapshots', {
      id: PARTITION, value: { junk: true }, writtenAt: 2,
    });

    const handle = await openWebLocalFirstStore({
      indexedDB: fakeIndexedDb, dbName: name, destination: BOUND, deviceId: 'device-web',
    });
    // The corrupt state is SURFACED...
    expect(handle.storage.state).toBe('corrupt');
    expect(classifyWebStoreFailure(new Error(WEB_CORRUPT_ERROR))).toBe('corrupt');
    // ...and no store is handed back, so no caller can read `{}` off it or
    // report a save that the database cannot hold.
    expect(handle.store).toBeUndefined();
    expect(handle.lease).toBeUndefined();
  });

  it('names each failure instead of collapsing them all to unavailable', () => {
    // The classifier must not be a one-trick stub: these are the states the
    // web host shows, and merging them would hide a recoverable condition.
    expect(classifyWebStoreFailure(new Error(WEB_CORRUPT_ERROR))).toBe('corrupt');
    expect(classifyWebStoreFailure(new Error(WEB_BUSY_ERROR))).toBe('busy');
    expect(classifyWebStoreFailure(new Error('disk quota exceeded'))).toBe('quota-exceeded');
    // A DOMException QuotaExceededError with no 'quota' in its message.
    const host = globalThis as { DOMException?: new (message?: string, name?: string) => Error };
    if (typeof host.DOMException === 'function') {
      expect(classifyWebStoreFailure(new host.DOMException('disk full', 'QuotaExceededError')))
        .toBe('quota-exceeded');
    }
    // Anything else is genuinely unavailable — but a bare string must not throw.
    expect(classifyWebStoreFailure(new Error('connection lost'))).toBe('unavailable');
    expect(classifyWebStoreFailure('local_first_snapshot_corrupt')).toBe('corrupt');
    expect(classifyWebStoreFailure(undefined)).toBe('unavailable');
    expect(classifyWebStoreFailure(null)).toBe('unavailable');
  });

  it('keeps the last good snapshot when a STAGED row does not validate', async () => {
    const name = dbName('corrupt-staged');
    const store = openStore(name, 'tab-a');
    try {
      await store.transact(async (tx) => {
        await tx.put(record('project', 'p-1', { name: 'Last good' }));
      });
      // A crash between stage and promote leaves this behind: the next open
      // must discard it, NOT promote it over the good snapshot.
      await plantRow(fakeIndexedDb, name, 'staged', {
        id: PARTITION, value: { records: null, events: null }, stagedAt: 99, writtenAt: 99,
      });
      const reopened = openStore(name, 'tab-b');
      try {
        const snapshot = await reopened.export();
        expect(snapshot.records).toHaveLength(1);
        expect(snapshot.records[0].payload).toEqual({ name: 'Last good' });
        // The bad staged row is gone, so it cannot be retried forever.
        expect(await readRow(fakeIndexedDb, name, 'staged', PARTITION)).toBeUndefined();
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
    }
  });

  it('never substitutes an empty record list for a corrupt read', async () => {
    const name = dbName('corrupt-empty');
    const store = createIndexedDbLocalFirstStore({
      indexedDB: fakeIndexedDb, dbName: name, partition: PARTITION, ownerId: 'tab-a',
    });
    try {
      await plantRow(fakeIndexedDb, name, 'snapshots', {
        id: PARTITION, value: { records: [], events: [], mappings: [], receipts: [],
          conflicts: [], cursors: {}, nextSequence: 'NOT-A-NUMBER' }, writtenAt: 1,
      });
      // nextSequence is the only invalid field: an array-shaped row that is
      // still not a snapshot. The read must throw rather than return it, which
      // is what an empty-but-successful read would look like to a caller.
      await expect(store.export()).rejects.toThrow(WEB_CORRUPT_ERROR);
    } finally {
      store.close();
    }
  });
});

describe('G26 web durability: recovery drops secrets', () => {
  it('strips secret-shaped keys from anything the web host may upload or log', () => {
    // Planted in the corrupt payload, exactly where a real one would sit.
    const corrupt = {
      records: [{ payload: { name: 'Live', apiKey: 'sk-live-SECRET123', client_secret: 'shh-SECRET123' } }],
      cursors: { unbound: 'c-1', sessionCookie: 'sc-SECRET123' },
    };
    const redacted = redactWebSnapshotForUploadOrLog(corrupt) as Record<string, unknown>;
    const text = JSON.stringify(redacted);
    expect(text).not.toContain('SECRET123');
    // The non-secret content survives — this is a strip, not a wipe.
    expect(text).toContain('Live');
    expect(text).toContain('c-1');
    // The input is not mutated, so the host still holds its own record.
    expect(JSON.stringify(corrupt)).toContain('SECRET123');

    // Nesting: a secret three levels down inside an array is stripped too.
    const deep = redactWebSnapshotForUploadOrLog({
      events: [{ payload: [{ nested: { authorization: 'Bearer SECRET123' } }] }],
    }) as Record<string, unknown>;
    expect(JSON.stringify(deep)).not.toContain('SECRET123');
  });

  it('uses the adapter\'s key list, so the web rule cannot drift from the store', () => {
    expect(WEB_SNAPSHOT_REDACTED_KEYS).toEqual(['token', 'password', 'authorization', 'cookie', 'apikey', 'clientsecret']);
    expect(WEB_SNAPSHOT_REDACTED_KEYS).toContain('token');
    expect(WEB_SNAPSHOT_REDACTED_KEYS).toContain('password');
    // The note embeds the adapter's own rule rather than restating it.
    expect(WEB_SNAPSHOT_REDACTION_NOTE).toContain('exportForUploadOrLog');
    expect(WEB_SNAPSHOT_REDACTION_NOTE).toContain('at every depth');
    expect(WEB_SNAPSHOT_REDACTION_NOTE.startsWith('Web: ')).toBe(true);
    for (const key of WEB_SNAPSHOT_REDACTED_KEYS) expect(WEB_SNAPSHOT_REDACTION_NOTE).toContain(key);
  });

  it('leaves no secret in the value the store marks as uploadable', async () => {
    const store = openStore(dbName('redaction'), 'tab-a');
    try {
      await store.transact(async (tx) => {
        // A host that wrote a credential into a record by mistake: the local
        // record keeps it, but the uploadable/loggable copy must not.
        await tx.put(record('project', 'p-1', { name: 'Account settings', apiKey: 'sk-live-SECRET123' }));
      });
      const forUpload = await store.exportForUploadOrLog();
      expect(JSON.stringify(forUpload)).not.toContain('SECRET123');
      // export() is the unfiltered local record and stays that way.
      expect(JSON.stringify(await store.export())).toContain('SECRET123');
    } finally {
      store.close();
    }
  });
});

describe('G26 web durability: durable across reload', () => {
  it('returns both ordered events, their binding and the pending batch to a fresh store', async () => {
    const name = dbName('reload');
    // Two ordered local events: the project first, then a ticket that depends
    // on it — the ordering a sync batch depends on.
    const first = openStore(name, 'tab-a');
    let projectId = '';
    try {
      const work = createWorkOver(first, 'device-web', BOUND);
      const project = await work.createProject({ name: 'Offline project', key: 'WEB' });
      projectId = project.id;
      const ticket = await work.createTicket({ projectId, title: 'Filed offline' });
      expect(ticket.payload.projectId).toBe(project.id);
      // A reload is a brand-new store object over the same database — nothing
      // survives in memory, only in the committed snapshot.
    } finally {
      first.close();
    }

    const reopened = openStore(name, 'tab-b');
    try {
      const work = createWorkOver(reopened, 'device-web', BOUND);
      const projects = await work.listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe(projectId);
      expect(projects[0].destination).toEqual(BOUND);

      const tickets = await work.listTickets({ projectId });
      expect(tickets).toHaveLength(1);
      expect(tickets[0].payload.title).toBe('Filed offline');
      // The destination is the PROJECT's, snapped at creation (G11): it is
      // still that after a reload, not re-derived from current sign-in.
      expect(tickets[0].destination).toEqual(BOUND);
      expect(destinationKey(tickets[0].destination)).toBe(PARTITION);

      // The pending sync batch is still there: both events, in order, with the
      // ticket depending on the project.
      const snapshot = await reopened.export();
      expect(snapshot.events).toHaveLength(2);
      expect(snapshot.events.map((event) => event.entityType)).toEqual(['project', 'ticket']);
      expect(snapshot.events[0].localSequence).toBeLessThan(snapshot.events[1].localSequence);
      const ticketEvent = snapshot.events[1];
      expect(ticketEvent.clientEntityId).toBe(tickets[0].id);
      expect(ticketEvent.dependsOn).toEqual([`project:${projectId}:v1`]);
      expect(snapshot.events.every((event) => destinationKey(event.destination) === PARTITION)).toBe(true);

      const pending = await reopened.read((tx) => tx.pending(BOUND));
      expect(pending).toHaveLength(2);
      expect(pending[0].eventId).toBe(`project:${projectId}:v1`);
      expect(pending[1].eventId).toBe(`ticket:${tickets[0].id}:v1`);
    } finally {
      reopened.close();
    }
  });

  it('does not let an unbound partition see a bound account\'s records', async () => {
    const name = dbName('partition');
    const bound = openStore(name, 'tab-a');
    const unboundName = name;
    try {
      await bound.transact(async (tx) => {
        await tx.put(record('project', 'p-1', { name: 'Bound work' }));
      });
    } finally {
      bound.close();
    }

    // A never-connected partition on the SAME database is a different row, so
    // it reads empty — not the other account's project.
    const unbound = createIndexedDbLocalFirstStore({
      indexedDB: fakeIndexedDb, dbName: unboundName,
      partition: destinationKey(UNBOUND_DESTINATION), ownerId: 'tab-c',
    });
    try {
      const snapshot = await unbound.export();
      expect(snapshot.records).toHaveLength(0);
    } finally {
      unbound.close();
    }
  });
});

/** The real web use cases over a store, as `workManagementBoot` wires them. */
function createWorkOver(store: IndexedDbLocalFirstStore, deviceId: string, destination: EntityDestination) {
  return createLocalWorkManagement({ store, deviceId, destination });
}
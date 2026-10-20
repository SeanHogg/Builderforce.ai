/**
 * IndexedDB local-first adapter — the browser half of G26 (equivalent
 * durability on the Web, Rovr, and VSIX stores).
 *
 * Four properties this adapter owes its host, and how each one is kept:
 *
 *   - CRASH-SAFE WRITE. A commit is two durable writes. The next snapshot is
 *     first STAGED, then PROMOTED: the promote is one transaction over the live
 *     and staged stores that puts the live row and deletes the staged row
 *     together, so the live snapshot is never a half-written value and the
 *     previous good snapshot survives until a promote actually commits. A
 *     process that dies after the stage write leaves the staged row behind and
 *     the next open promotes it, so an acknowledged write is never lost and an
 *     unacknowledged one is never half-applied. A failed commit throws with the
 *     live row untouched.
 *
 *   - BUSY TIMEOUT, NEVER A LOCK STEAL, NEVER BRICKED. One owner holds a lease
 *     per partition while it works. A second owner POLLS for up to
 *     `busyTimeoutMs` and then fails with `local_first_store_busy`; it does not
 *     write, and it does not take a LIVE holder's lease. Age — including an age
 *     far past `leaseMs` — never admits a second owner. A holder that died
 *     without releasing (closed tab, crash) is reclaimed only on proof of death:
 *     the browser released its Web Lock, or (without Web Locks) its heartbeat
 *     stopped long ago. See `indexedDbLease.ts`.
 *
 *   - CORRUPT-STORE RECOVERY. A staged row that no longer validates is deleted
 *     on open and the previous good live snapshot is kept — a parse that failed
 *     never replaces it. A live row that does not validate but has a valid
 *     staged row is rescued by that promotion. A live row with no recoverable
 *     staged row throws `local_first_snapshot_corrupt`, which hosts classify as
 *     a corrupt store rather than reporting a fake success or substituting an
 *     in-memory map.
 *
 *   - REDACTION RULE (stated, not implied). `export()` returns the snapshot as
 *     stored — that is the local record of truth and it is not filtered.
 *     `exportForUploadOrLog()` returns the ONLY value eligible to leave the
 *     device (upload, log, crash report, support bundle): secret-shaped keys are
 *     stripped at every depth, recursively, before the copy is returned. See
 *     `INDEXEDDB_REDACTION_RULE`. A secret stays in credential storage and is
 *     never a snapshot field.
 *
 * Reads are not served from a stale cache: `read` and `export` read the live
 * row, so a record written by another tab is visible here.
 *
 * The adapter opens IndexedDB (and the browser's Web Locks, for the lease) and
 * nothing else. It writes no file, takes no OS lock, calls no network, and
 * imports no host.
 */

import { idbRequest, trackComplete } from './idbTransaction.js';
import { LEASES_STORE, createPartitionLease, type LeaseLockManager, type LeaseRow } from './indexedDbLease.js';
import { redactSnapshotForUploadOrLog } from './redaction.js';
import type { SyncLease } from './sync.js';
import { createMemoryLocalFirstStore, type LocalFirstSnapshot, type LocalFirstStore } from './store.js';

const SNAPSHOTS = 'snapshots';
const LEASES = LEASES_STORE;
const STAGED = 'staged';
const VERSION = 2;

interface SnapshotRow {
  id: string;
  value: LocalFirstSnapshot;
  writtenAt: number;
}

interface StagedRow extends SnapshotRow {
  stagedAt: number;
}

export interface IndexedDbLocalFirstOptions {
  indexedDB: IDBFactory;
  dbName: string;
  partition?: string;
  leaseMs?: number;
  /** How long a contender polls for the lease before reporting busy. */
  busyTimeoutMs?: number;
  /** Poll interval while contending for the lease. */
  busyPollMs?: number;
  now?: () => number;
  ownerId?: string;
  /**
   * Web Locks used to prove a dead holder. Defaults to `navigator.locks`; `null`
   * forces the heartbeat fallback.
   */
  locks?: LeaseLockManager | null;
  /** Heartbeat age that proves a holder dead (fallback only). Defaults to `leaseStaleAfterMs(leaseMs)`. */
  staleAfterMs?: number;
  /** A lease heartbeat or release write failed. Defaults to `console.warn`. */
  onLeaseError?: (error: unknown) => void;
}

/** Contender gives up after this long without ever taking the lease. */
export const DEFAULT_BUSY_TIMEOUT_MS = 1_500;
/** Poll interval between lease attempts while another owner holds it. */
export const DEFAULT_BUSY_POLL_MS = 25;

export {
  leaseStaleAfterMs,
  type LeaseLockManager,
  type LeaseRow,
} from './indexedDbLease.js';

export {
  INDEXEDDB_REDACTED_KEYS,
  INDEXEDDB_REDACTION_RULE,
  redactSnapshotForUploadOrLog,
} from './redaction.js';

function validSnapshot(value: unknown): value is LocalFirstSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<LocalFirstSnapshot>;
  return Array.isArray(snapshot.records)
    && Array.isArray(snapshot.events)
    && Array.isArray(snapshot.mappings)
    && Array.isArray(snapshot.receipts)
    && Array.isArray(snapshot.conflicts)
    && typeof snapshot.cursors === 'object'
    && snapshot.cursors !== null
    && typeof snapshot.nextSequence === 'number';
}

const emptySnapshot = (): LocalFirstSnapshot => ({
  records: [],
  events: [],
  mappings: [],
  receipts: [],
  conflicts: [],
  cursors: {},
  nextSequence: 1,
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, ms); });

export interface IndexedDbLocalFirstStore extends LocalFirstStore {
  withLease<R>(work: () => Promise<R>): Promise<R>;
  /** The redacted snapshot: the only value eligible to be uploaded or logged. */
  exportForUploadOrLog(): Promise<LocalFirstSnapshot>;
  /** Who holds this partition's lease, for host display. Never a steal. */
  leaseOwner(): Promise<LeaseRow | undefined>;
  close(): void;
}

export function createIndexedDbLocalFirstStore(options: IndexedDbLocalFirstOptions): IndexedDbLocalFirstStore {
  const partition = options.partition ?? 'default';
  const leaseKey = `store:${partition}`;
  const owner = `${options.ownerId ?? crypto.randomUUID()}:${Math.random().toString(36).slice(2)}`;
  const now = options.now ?? (() => Date.now());
  const leaseMs = options.leaseMs ?? 10_000;
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const busyPollMs = options.busyPollMs ?? DEFAULT_BUSY_POLL_MS;
  let database: IDBDatabase | undefined;
  let opening: Promise<IDBDatabase> | undefined;
  let recovery: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  const open = (): Promise<IDBDatabase> => {
    if (database) return Promise.resolve(database);
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = options.indexedDB.open(options.dbName, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(LEASES)) db.createObjectStore(LEASES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STAGED)) db.createObjectStore(STAGED, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        database = req.result;
        database.onversionchange = () => {
          database?.close();
          database = undefined;
          opening = undefined;
        };
        resolve(database);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('indexeddb_open_blocked'));
    }).catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
    return opening;
  };

  /**
   * Crash recovery, run once per open. A staged row that validates is promoted
   * into the live snapshot; one that does not is deleted and the previous good
   * live snapshot is kept. Never throws and never replaces a good snapshot with
   * a value that failed to parse.
   */
  const recoverStaged = async (): Promise<void> => {
    const db = await open();
    const tx = db.transaction([SNAPSHOTS, STAGED], 'readwrite');
    const tracked = trackComplete(tx);
    const live = tx.objectStore(SNAPSHOTS);
    const staged = tx.objectStore(STAGED);
    await new Promise<void>((resolve, reject) => {
      const req = staged.get(partition);
      req.onsuccess = () => {
        const row = req.result as StagedRow | undefined;
        if (row) {
          if (validSnapshot(row.value)) {
            live.put({ id: partition, value: row.value, writtenAt: now() } satisfies SnapshotRow);
          }
          staged.delete(partition);
        }
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('indexeddb_recovery_read_failed'));
    });
    await tracked;
  };

  const ensureRecovered = (): Promise<void> => {
    recovery ??= recoverStaged().catch(() => undefined);
    return recovery;
  };

  const readLatest = async (): Promise<LocalFirstSnapshot> => {
    const db = await open();
    await ensureRecovered();
    const tx = db.transaction(SNAPSHOTS, 'readonly');
    const tracked = trackComplete(tx);
    const row = await idbRequest(tx.objectStore(SNAPSHOTS).get(partition) as IDBRequest<SnapshotRow | undefined>);
    await tracked;
    if (!row) return emptySnapshot();
    if (!validSnapshot(row.value)) throw new Error('local_first_snapshot_corrupt');
    return structuredClone(row.value);
  };

  const lease = createPartitionLease({
    open: async () => {
      const db = await open();
      await ensureRecovered();
      return db;
    },
    leaseKey,
    lockName: `builderforce-local-first:${options.dbName}:${leaseKey}`,
    owner,
    now,
    leaseMs,
    ...(options.locks !== undefined ? { locks: options.locks } : {}),
    ...(options.staleAfterMs !== undefined ? { staleAfterMs: options.staleAfterMs } : {}),
    onError: options.onLeaseError ?? ((error: unknown) => console.warn('local-first lease write failed', error)),
  });

  /**
   * Busy timeout. Poll until the holder releases, for at most `busyTimeoutMs`,
   * then report busy. This never writes and never takes a held lease.
   *
   * The deadline is measured on the real clock as well as `now()`, so an
   * injected clock that does not advance cannot turn the wait into a spin
   * forever.
   */
  const acquire = async (): Promise<void> => {
    const realDeadline = Date.now() + Math.max(0, busyTimeoutMs);
    for (;;) {
      if (await lease.tryAcquire()) return;
      if (Date.now() >= realDeadline) throw new Error('local_first_store_busy');
      await delay(busyPollMs);
    }
  };

  /** Crash-safe commit: stage, then promote in one transaction over both rows. */
  const persist = async (value: LocalFirstSnapshot): Promise<void> => {
    const db = await open();
    await ensureRecovered();

    const stageTx = db.transaction(STAGED, 'readwrite');
    const stageTracked = trackComplete(stageTx);
    stageTx.objectStore(STAGED).put({
      id: partition,
      value,
      writtenAt: now(),
      stagedAt: now(),
    } satisfies StagedRow);
    await stageTracked;

    const promoteTx = db.transaction([SNAPSHOTS, STAGED], 'readwrite');
    const promoteTracked = trackComplete(promoteTx);
    const live = promoteTx.objectStore(SNAPSHOTS);
    const staged = promoteTx.objectStore(STAGED);
    await new Promise<void>((resolve, reject) => {
      const req = staged.get(partition);
      req.onsuccess = () => {
        const row = req.result as StagedRow | undefined;
        if (row && validSnapshot(row.value)) {
          live.put({ id: partition, value: row.value, writtenAt: now() } satisfies SnapshotRow);
        }
        staged.delete(partition);
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('indexeddb_promote_read_failed'));
    });
    await promoteTracked;
  };

  const load = (): Promise<LocalFirstSnapshot> => readLatest();

  const withLease = async <R>(work: () => Promise<R>): Promise<R> => {
    await acquire();
    try {
      return await work();
    } finally {
      await lease.release();
    }
  };

  return {
    async read(work) {
      const current = await load();
      return createMemoryLocalFirstStore(current).read(work);
    },
    withLease,
    transact(work) {
      const run = tail.then(() => withLease(async () => {
        const latest = await readLatest();
        const memory = createMemoryLocalFirstStore(latest);
        const result = await memory.transact(work);
        const next = await memory.export();
        await persist(next);
        for (const listener of [...listeners]) listener();
        return result;
      }));
      tail = run.catch(() => undefined);
      return run;
    },
    async export() {
      return structuredClone(await load());
    },
    async exportForUploadOrLog() {
      return redactSnapshotForUploadOrLog(await load());
    },
    leaseOwner: () => lease.owner(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      database?.close();
      database = undefined;
      opening = undefined;
      recovery = undefined;
    },
  };
}

export function createIndexedDbSyncLease(options: IndexedDbLocalFirstOptions): SyncLease {
  const store = createIndexedDbLocalFirstStore(options);
  return {
    async run<R>(_owner: string, work: () => Promise<R>): Promise<R | undefined> {
      try {
        return await store.withLease(work);
      } catch (error: unknown) {
        // Busy after the timeout: another owner still holds it. This tab does
        // not sync; it never steals the lease to do so.
        if (error instanceof Error && error.message === 'local_first_store_busy') return undefined;
        throw error;
      }
    },
  };
}
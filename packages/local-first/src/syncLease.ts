/**
 * Exclusive in-memory sync lease (G24).
 *
 * Two coordinators must not push the same journal at once. Every handle from
 * `createSyncLease` shares one slot per journal (the default journal when
 * none is named). `acquire` returns true only when that slot is empty,
 * expired, or already held by the same owner. A live slot held by someone
 * else returns false. `release` deletes the slot only when this caller still
 * owns it, including after another owner has taken an expired slot.
 *
 * Timestamps are epoch milliseconds from `now`. A slot is live while
 * `expiresAt > now()`. Re-acquire by the current owner refreshes `expiresAt`
 * to `now() + ttlMs` so a holder can keep the journal for a long push.
 *
 * Process-local only. This module does not open IndexedDB, take a file lock,
 * or call the network. No host constructs the sync coordinator yet.
 */

export interface SyncLeaseOptions {
  readonly owner: string;
  readonly now: () => number;
  readonly ttlMs: number;
  /** Identifies the journal. Handles that omit it contend for one default slot. */
  readonly journal?: string;
}

export interface SyncLeaseHandle {
  acquire(): boolean;
  release(): void;
}

interface LeaseSlot {
  owner: string;
  expiresAt: number;
}

const slots = new Map<string, LeaseSlot>();
const DEFAULT_JOURNAL = 'default';

function requireOwner(owner: string): string {
  if (typeof owner !== 'string' || owner.length === 0) throw new Error('sync_lease_owner_required');
  return owner;
}

function requireClock(now: () => number): () => number {
  if (typeof now !== 'function') throw new Error('sync_lease_clock_required');
  return now;
}

function requireTtl(ttlMs: number): number {
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('sync_lease_ttl_invalid');
  return ttlMs;
}

function requireJournal(journal: string | undefined): string {
  if (journal === undefined) return DEFAULT_JOURNAL;
  if (typeof journal !== 'string' || journal.length === 0) throw new Error('sync_lease_journal_required');
  return journal;
}

function readClock(now: () => number): number {
  const at = now();
  if (typeof at !== 'number' || !Number.isFinite(at)) throw new Error('sync_lease_clock_invalid');
  return at;
}

function isLive(slot: LeaseSlot | undefined, at: number): slot is LeaseSlot {
  return slot !== undefined && slot.expiresAt > at;
}

export function createSyncLease(options: SyncLeaseOptions): SyncLeaseHandle {
  const owner = requireOwner(options.owner);
  const now = requireClock(options.now);
  const ttlMs = requireTtl(options.ttlMs);
  const journal = requireJournal(options.journal);

  return {
    acquire(): boolean {
      const at = readClock(now);
      const current = slots.get(journal);
      if (isLive(current, at) && current.owner !== owner) return false;
      slots.set(journal, { owner, expiresAt: at + ttlMs });
      return true;
    },
    release(): void {
      const current = slots.get(journal);
      if (current?.owner === owner) slots.delete(journal);
    },
  };
}

/**
 * One in-flight coordinator per device store (G24).
 *
 * `createSyncCoordinator` consults `run`. A second coordinator for the same
 * device store gets `undefined` and does not run its work while the first
 * still holds the slot. Age does not steal that hold: `ttlMs` elapsing during
 * the in-flight `run` does not admit the second coordinator. `holds` is true
 * only for the instance that acquired the slot, so two coordinators cannot
 * both believe they hold the lease.
 *
 * No host constructs the sync coordinator yet.
 */
export interface DeviceStoreCoordinatorLease {
  readonly deviceStore: string;
  holds(): boolean;
  run<R>(owner: string, work: () => Promise<R>): Promise<R | undefined>;
}

interface DeviceStoreSlot {
  token: string;
  depth: number;
  expiresAt: number;
}

const deviceStoreSlots = new Map<string, DeviceStoreSlot>();

function requireDeviceStore(deviceStore: string): string {
  if (typeof deviceStore !== 'string' || deviceStore.length === 0) {
    throw new Error('sync_lease_device_store_required');
  }
  return deviceStore;
}

export function createDeviceStoreCoordinatorLease(options: {
  readonly deviceStore: string;
  readonly now: () => number;
  readonly ttlMs: number;
}): DeviceStoreCoordinatorLease {
  const deviceStore = requireDeviceStore(options.deviceStore);
  const now = requireClock(options.now);
  const ttlMs = requireTtl(options.ttlMs);
  const token = crypto.randomUUID();

  const read = (): DeviceStoreSlot | undefined => deviceStoreSlots.get(deviceStore);

  return {
    deviceStore,
    holds(): boolean {
      const current = read();
      return current?.token === token && current.depth > 0;
    },
    async run<R>(_owner: string, work: () => Promise<R>): Promise<R | undefined> {
      const at = readClock(now);
      const current = read();
      if (current && (current.depth > 0 || (current.token !== token && current.expiresAt > at))) {
        return undefined;
      }
      deviceStoreSlots.set(deviceStore, { token, depth: 1, expiresAt: at + ttlMs });
      try {
        return await work();
      } finally {
        const held = read();
        if (held?.token === token) deviceStoreSlots.delete(deviceStore);
      }
    },
  };
}

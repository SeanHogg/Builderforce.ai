/**
 * Exclusive in-memory sync lease (G24).
 *
 * Two coordinators must not push the same journal at once. Every handle from
 * `createSyncLease` shares one slot per device and journal (the default device
 * and journal when neither is named). `acquire` returns true only when that
 * slot is empty, expired, or already held by this handle's token. A live slot
 * held by any other handle — including another handle with the same owner —
 * returns false. Age does not steal: a future `expiresAt` stays held, including
 * at 30s. There is no steal window. An expiry in the past, or equal to now, is
 * not held.
 *
 * `release` and `renew` affect the slot only when this handle's token still
 * matches. A second entry point cannot clear or extend a lease it did not
 * acquire, including after it has taken an expired slot. Re-acquire by the
 * holding handle refreshes `expiresAt` to `now() + ttlMs`.
 *
 * Two devices never block each other, even on the same journal name. Timestamps
 * are epoch milliseconds from `now`. A slot is live while `expiresAt > now()`.
 *
 * `createDeviceStoreCoordinatorLease` is the lease `createSyncCoordinator` runs
 * under. One slot per device store. `run` returns undefined when that store
 * already has a live lease, including while a holder is mid-transaction. Age
 * does not steal that in-flight hold: advancing past `ttlMs` does not admit a
 * second entry point. The holder releases when its work finishes — or when the
 * work overruns `workTimeoutMs` on the real clock: then its AbortSignal fires,
 * the slot is released, and `run` rejects `sync_lease_work_timeout`. The slot
 * is FENCED by a per-run token, so the timed-out work's late completion cannot
 * release (or be mistaken for) the next holder, and the work can ask
 * `fence.holds()` before it commits anything. A different device store never
 * blocks this one. An expiry in the past, with nobody in flight, is not held; a
 * future `expiresAt` is.
 *
 * Process-local only. This module does not open IndexedDB, take a file lock,
 * or call the network.
 */

export interface SyncLeaseOptions {
  readonly owner: string;
  readonly now: () => number;
  readonly ttlMs: number;
  /** Identifies the journal. Handles that omit it contend for one default slot. */
  readonly journal?: string;
  /** Identifies the device store. Handles that omit it share one default device. */
  readonly deviceId?: string;
}

export interface SyncLeaseHandle {
  acquire(): boolean;
  release(): void;
  renew(): boolean;
}

interface LeaseSlot {
  token: string;
  owner: string;
  expiresAt: number;
}

const byDevice = new Map<string, Map<string, LeaseSlot>>();
const DEFAULT_JOURNAL = 'default';
const DEFAULT_DEVICE = 'default';

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

function requireDevice(deviceId: string | undefined): string {
  if (deviceId === undefined) return DEFAULT_DEVICE;
  if (typeof deviceId !== 'string' || deviceId.length === 0) throw new Error('sync_lease_device_required');
  return deviceId;
}

function readClock(now: () => number): number {
  const at = now();
  if (typeof at !== 'number' || !Number.isFinite(at)) throw new Error('sync_lease_clock_invalid');
  return at;
}

function isLive(slot: LeaseSlot | undefined, at: number): slot is LeaseSlot {
  return slot !== undefined && slot.expiresAt > at;
}

function readSlot(deviceId: string, journal: string): LeaseSlot | undefined {
  return byDevice.get(deviceId)?.get(journal);
}

function writeSlot(deviceId: string, journal: string, slot: LeaseSlot): void {
  let journals = byDevice.get(deviceId);
  if (!journals) {
    journals = new Map();
    byDevice.set(deviceId, journals);
  }
  journals.set(journal, slot);
}

function deleteSlot(deviceId: string, journal: string): void {
  const journals = byDevice.get(deviceId);
  if (!journals) return;
  journals.delete(journal);
  if (journals.size === 0) byDevice.delete(deviceId);
}

export function createSyncLease(options: SyncLeaseOptions): SyncLeaseHandle {
  const owner = requireOwner(options.owner);
  const now = requireClock(options.now);
  const ttlMs = requireTtl(options.ttlMs);
  const journal = requireJournal(options.journal);
  const deviceId = requireDevice(options.deviceId);
  let token: string | undefined;

  return {
    acquire(): boolean {
      const at = readClock(now);
      const current = readSlot(deviceId, journal);
      if (isLive(current, at)) {
        if (token === undefined || current.token !== token) return false;
        current.expiresAt = at + ttlMs;
        return true;
      }
      const next = crypto.randomUUID();
      token = next;
      writeSlot(deviceId, journal, { token: next, owner, expiresAt: at + ttlMs });
      return true;
    },
    release(): void {
      const current = readSlot(deviceId, journal);
      if (current && token !== undefined && current.token === token) {
        deleteSlot(deviceId, journal);
        token = undefined;
      }
    },
    renew(): boolean {
      const at = readClock(now);
      const current = readSlot(deviceId, journal);
      if (!current || token === undefined || current.token !== token) return false;
      current.expiresAt = at + ttlMs;
      return true;
    },
  };
}

export interface DeviceStoreCoordinatorLeaseOptions {
  readonly deviceStore: string;
  readonly now: () => number;
  readonly ttlMs: number;
  /**
   * Real-clock budget for one `run`. Past it the work is aborted and the slot
   * released, so a hung holder cannot keep the store's coordinator out forever.
   * Default {@link DEFAULT_COORDINATOR_WORK_TIMEOUT_MS}.
   */
  readonly workTimeoutMs?: number;
  /** A timed-out run's work failed after the slot was released. Default `console.warn`. */
  readonly onLateError?: (error: unknown) => void;
}

/** Five minutes: longer than any sane sync session, short of "forever". */
export const DEFAULT_COORDINATOR_WORK_TIMEOUT_MS = 5 * 60_000;

/** Handed to the work of one `run`. */
export interface CoordinatorLeaseFence {
  /** Fires when the run overruns `workTimeoutMs`. Stop and do not commit. */
  readonly signal: AbortSignal;
  /** True while this run still owns the slot. Check before committing. */
  holds(): boolean;
}

export interface DeviceStoreCoordinatorLease {
  holds(): boolean;
  run<R>(owner: string, work: (fence: CoordinatorLeaseFence) => Promise<R>): Promise<R | undefined>;
}

interface DeviceStoreSlot {
  token: string;
  expiresAt: number;
  inFlight: boolean;
}

const deviceStores = new Map<string, DeviceStoreSlot>();

function requireDeviceStore(deviceStore: string): string {
  if (typeof deviceStore !== 'string' || deviceStore.length === 0) throw new Error('sync_lease_device_store_required');
  return deviceStore;
}

/** In flight until release. Otherwise held only while expiresAt is still in the future. */
function deviceStoreHeld(slot: DeviceStoreSlot | undefined, at: number): slot is DeviceStoreSlot {
  if (slot === undefined) return false;
  if (slot.inFlight) return true;
  return slot.expiresAt > at;
}

/**
 * One coordinator lease for a device store.
 *
 * A second `run` returns undefined while the slot is in flight or still has a
 * future `expiresAt`. Passing `ttlMs` does not steal an in-flight holder.
 * `holds` is true only for the handle whose token owns that slot.
 */
export function createDeviceStoreCoordinatorLease(
  options: DeviceStoreCoordinatorLeaseOptions,
): DeviceStoreCoordinatorLease {
  const deviceStore = requireDeviceStore(options.deviceStore);
  const now = requireClock(options.now);
  const ttlMs = requireTtl(options.ttlMs);
  const workTimeoutMs = requireTtl(options.workTimeoutMs ?? DEFAULT_COORDINATOR_WORK_TIMEOUT_MS);
  const onLateError = options.onLateError
    ?? ((error: unknown) => console.warn('sync coordinator: timed-out run failed late', error));
  let token: string | undefined;

  const releaseSlot = (owned: string): void => {
    const slot = deviceStores.get(deviceStore);
    if (slot?.token === owned) deviceStores.delete(deviceStore);
    if (token === owned) token = undefined;
  };

  return {
    holds(): boolean {
      if (token === undefined) return false;
      const slot = deviceStores.get(deviceStore);
      if (!deviceStoreHeld(slot, readClock(now))) return false;
      return slot.token === token;
    },
    async run<R>(_owner: string, work: (fence: CoordinatorLeaseFence) => Promise<R>): Promise<R | undefined> {
      const at = readClock(now);
      const current = deviceStores.get(deviceStore);
      if (deviceStoreHeld(current, at)) return undefined;
      const next = crypto.randomUUID();
      token = next;
      deviceStores.set(deviceStore, { token: next, expiresAt: at + ttlMs, inFlight: true });
      const controller = new AbortController();
      const fence: CoordinatorLeaseFence = {
        signal: controller.signal,
        holds: () => !controller.signal.aborted && deviceStores.get(deviceStore)?.token === next,
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error('sync_lease_work_timeout');
          controller.abort(error);
          // Fenced: only this run's token is released. A later holder is untouched.
          releaseSlot(next);
          reject(error);
        }, workTimeoutMs);
      });
      const working = Promise.resolve().then(() => work(fence));
      try {
        return await Promise.race([working, timedOut]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (controller.signal.aborted) {
          // The late completion of a timed-out holder is discarded, never returned
          // to anyone, and its failure is reported rather than lost.
          working.catch(onLateError);
        }
        releaseSlot(next);
      }
    },
  };
}

import { beforeEach, describe, expect, it } from 'vitest';
import { createPlatformPolicy } from './policy.js';
import type { EntityDestination } from './records.js';
import { createMemoryLocalFirstStore } from './store.js';
import { createSyncCoordinator } from './sync.js';
import { createDeviceStoreCoordinatorLease, createSyncLease } from './syncLease.js';

const TTL_MS = 1_000;
let clock = 0;
const now = (): number => clock;

beforeEach(() => {
  clock += 60_000;
});

function lease(owner: string, journal?: string, ttlMs = TTL_MS) {
  return createSyncLease({ owner, now, ttlMs, ...(journal ? { journal } : {}) });
}

describe('sync lease', () => {
  it('grants the first owner and refuses a second owner while the lease is live', () => {
    const first = lease('coordinator-a');
    const second = lease('coordinator-b');

    expect(first.acquire()).toBe(true);
    expect(second.acquire()).toBe(false);
    expect(first.acquire()).toBe(true);
  });

  it('does not let a second handle sync or steal a live lease, even with the same owner', () => {
    const first = lease('coordinator-a');
    const again = lease('coordinator-a');
    const other = lease('coordinator-b');

    expect(first.acquire()).toBe(true);
    clock += TTL_MS - 1;
    expect(again.acquire()).toBe(false);
    expect(again.renew()).toBe(false);
    again.release();
    expect(other.acquire()).toBe(false);
    expect(first.renew()).toBe(true);
    clock += TTL_MS - 1;
    expect(other.acquire()).toBe(false);
    expect(again.acquire()).toBe(false);
  });

  it('does not let a stale token release or renew after another handle takes an expired lease', () => {
    const first = lease('coordinator-a');
    const again = lease('coordinator-a');

    expect(first.acquire()).toBe(true);
    clock += TTL_MS;
    expect(again.acquire()).toBe(true);
    expect(first.renew()).toBe(false);
    first.release();
    expect(again.acquire()).toBe(true);
    expect(lease('coordinator-b').acquire()).toBe(false);
  });

  it('does not steal a live lease because it is 30s old', () => {
    const first = lease('coordinator-a', 'aged', 120_000);
    const second = lease('coordinator-b', 'aged', 120_000);

    expect(first.acquire()).toBe(true);
    clock += 30_000;
    expect(second.acquire()).toBe(false);
    clock += 89_999;
    expect(second.acquire()).toBe(false);
    clock += 1;
    expect(second.acquire()).toBe(true);
    expect(first.renew()).toBe(false);
    first.release();
    expect(second.acquire()).toBe(true);
  });

  it('does not let one device block another', () => {
    const a = createSyncLease({ owner: 'coordinator-a', deviceId: 'device-a', now, ttlMs: TTL_MS, journal: 'shared' });
    const b = createSyncLease({ owner: 'coordinator-b', deviceId: 'device-b', now, ttlMs: TTL_MS, journal: 'shared' });
    const sameDevice = createSyncLease({ owner: 'coordinator-c', deviceId: 'device-a', now, ttlMs: TTL_MS, journal: 'shared' });

    expect(a.acquire()).toBe(true);
    expect(b.acquire()).toBe(true);
    expect(sameDevice.acquire()).toBe(false);
    b.release();
    expect(a.acquire()).toBe(true);
    expect(sameDevice.acquire()).toBe(false);
  });

  it('release clears only the caller lease', () => {
    const first = lease('coordinator-a');
    const second = lease('coordinator-b');
    const third = lease('coordinator-c');

    expect(first.acquire()).toBe(true);
    second.release();
    expect(second.acquire()).toBe(false);

    first.release();
    expect(second.acquire()).toBe(true);
    first.release();
    expect(third.acquire()).toBe(false);
    expect(second.acquire()).toBe(true);
  });

  it('lets another owner acquire an expired lease and ignores the previous owner release', () => {
    const first = lease('coordinator-a');
    const second = lease('coordinator-b');

    expect(first.acquire()).toBe(true);
    clock += TTL_MS - 1;
    expect(second.acquire()).toBe(false);

    clock += 1;
    expect(second.acquire()).toBe(true);
    first.release();
    expect(first.acquire()).toBe(false);
    expect(second.acquire()).toBe(true);

    second.release();
    expect(first.acquire()).toBe(true);
  });

  it('does not let a different journal block this one', () => {
    const first = lease('coordinator-a', 'journal-a');
    const otherJournal = lease('coordinator-b', 'journal-b');
    const sameJournal = lease('coordinator-c', 'journal-a');

    expect(first.acquire()).toBe(true);
    expect(otherJournal.acquire()).toBe(true);
    expect(sameJournal.acquire()).toBe(false);
  });

  it('rejects a missing owner, clock, journal, or non-positive ttl', () => {
    expect(() => createSyncLease({ owner: '', now, ttlMs: TTL_MS })).toThrow('sync_lease_owner_required');
    expect(() => createSyncLease({ owner: 'a', now: undefined as unknown as () => number, ttlMs: TTL_MS })).toThrow('sync_lease_clock_required');
    expect(() => createSyncLease({ owner: 'a', now, ttlMs: 0 })).toThrow('sync_lease_ttl_invalid');
    expect(() => createSyncLease({ owner: 'a', now, ttlMs: TTL_MS, journal: '' })).toThrow('sync_lease_journal_required');
    expect(() => createSyncLease({ owner: 'a', now, ttlMs: TTL_MS, deviceId: '' })).toThrow('sync_lease_device_required');
    const broken = createSyncLease({ owner: 'a', now: () => Number.NaN, ttlMs: TTL_MS, journal: 'bad-clock' });
    expect(() => broken.acquire()).toThrow('sync_lease_clock_invalid');
  });
});

const destination: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'account-a',
  tenantId: 'tenant-a',
  projectId: 'project-a',
};

describe('device store coordinator lease', () => {
  it('refuses a second coordinator for the same device store while the first holds the lease', async () => {
    const deviceStore = `device-store-${clock}`;
    const firstLease = createDeviceStoreCoordinatorLease({ deviceStore, now, ttlMs: TTL_MS });
    const secondLease = createDeviceStoreCoordinatorLease({ deviceStore, now, ttlMs: TTL_MS });
    const policy = createPlatformPolicy({ synchronize: true });
    const store = createMemoryLocalFirstStore();
    let releasePull: () => void = () => undefined;
    const pullGate = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    let entered: () => void = () => undefined;
    const enteredPull = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let firstPulls = 0;
    let secondPulls = 0;
    const first = createSyncCoordinator({
      store,
      transport: {
        pull: async () => {
          firstPulls += 1;
          if (firstPulls === 1) {
            entered();
            await pullGate;
          }
          return { records: [] };
        },
        push: async () => [],
      },
      policy,
      deviceId: 'device-a',
      lease: firstLease,
    });
    const second = createSyncCoordinator({
      store,
      transport: {
        pull: async () => {
          secondPulls += 1;
          return { records: [] };
        },
        push: async () => [],
      },
      policy,
      deviceId: 'device-a',
      lease: secondLease,
    });

    const firstSync = first.synchronize(destination);
    await enteredPull;
    expect(firstLease.holds()).toBe(true);
    expect(secondLease.holds()).toBe(false);
    expect([firstLease, secondLease].filter((lease) => lease.holds())).toHaveLength(1);

    const refused = await second.synchronize(destination);
    expect(refused).toBeUndefined();
    expect(secondPulls).toBe(0);
    expect(firstLease.holds()).toBe(true);
    expect(secondLease.holds()).toBe(false);
    expect(firstLease.holds() && secondLease.holds()).toBe(false);

    clock += TTL_MS + 1;
    const stolen = await second.synchronize(destination);
    expect(stolen).toBeUndefined();
    expect(secondPulls).toBe(0);
    expect(secondLease.holds()).toBe(false);
    expect(firstLease.holds()).toBe(true);

    releasePull();
    await expect(firstSync).resolves.toMatchObject({ pushed: 0, pulled: 0 });
    expect(firstLease.holds()).toBe(false);
    expect(secondLease.holds()).toBe(false);

    const after = await second.synchronize(destination);
    expect(after).toMatchObject({ pushed: 0, pulled: 0 });
    expect(secondPulls).toBe(1);
    expect(firstLease.holds() && secondLease.holds()).toBe(false);
  });

  it('does not let a different device store block this coordinator', async () => {
    const firstLease = createDeviceStoreCoordinatorLease({ deviceStore: `store-a-${clock}`, now, ttlMs: TTL_MS });
    const otherLease = createDeviceStoreCoordinatorLease({ deviceStore: `store-b-${clock}`, now, ttlMs: TTL_MS });
    let releasePull: () => void = () => undefined;
    const pullGate = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    let entered: () => void = () => undefined;
    const enteredPull = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = createSyncCoordinator({
      store: createMemoryLocalFirstStore(),
      transport: {
        pull: async () => {
          entered();
          await pullGate;
          return { records: [] };
        },
        push: async () => [],
      },
      policy: createPlatformPolicy({ synchronize: true }),
      deviceId: 'device-a',
      lease: firstLease,
    });
    const other = createSyncCoordinator({
      store: createMemoryLocalFirstStore(),
      transport: {
        pull: async () => ({ records: [] }),
        push: async () => [],
      },
      policy: createPlatformPolicy({ synchronize: true }),
      deviceId: 'device-b',
      lease: otherLease,
    });

    const firstSync = first.synchronize(destination);
    await enteredPull;
    const otherSummary = await other.synchronize(destination);
    expect(otherSummary).toMatchObject({ pushed: 0, pulled: 0 });
    expect(firstLease.holds()).toBe(true);
    expect(otherLease.holds()).toBe(false);
    expect(firstLease.holds() && otherLease.holds()).toBe(false);
    releasePull();
    await firstSync;
  });

  it('rejects a missing device store', () => {
    expect(() => createDeviceStoreCoordinatorLease({ deviceStore: '', now, ttlMs: TTL_MS })).toThrow('sync_lease_device_store_required');
  });

  it('aborts a hung holder after workTimeoutMs and fences its late completion out of the next holder', async () => {
    const deviceStore = `hung-store-${clock}`;
    const late: unknown[] = [];
    const hung = createDeviceStoreCoordinatorLease({
      deviceStore,
      now,
      ttlMs: TTL_MS,
      workTimeoutMs: 20,
      onLateError: (error) => late.push(error),
    });
    const next = createDeviceStoreCoordinatorLease({ deviceStore, now, ttlMs: TTL_MS });

    let finishHung: () => void = () => undefined;
    let fenceOfHung: { signal: AbortSignal; holds(): boolean } | undefined;
    const hungRun = hung.run('hung', (fence) => {
      fenceOfHung = fence;
      return new Promise<string>((resolve, reject) => {
        finishHung = () => (fence.holds() ? resolve('committed') : reject(new Error('fenced_out')));
      });
    });
    await expect(hungRun).rejects.toThrow('sync_lease_work_timeout');
    expect(fenceOfHung?.signal.aborted).toBe(true);
    expect(hung.holds()).toBe(false);

    // The slot is free: the next coordinator runs while the hung work is still pending.
    let releaseNext: () => void = () => undefined;
    const nextRun = next.run('next', () => new Promise<string>((resolve) => {
      releaseNext = () => resolve('next-done');
    }));
    expect(next.holds()).toBe(true);

    // The late completion neither commits nor releases the new holder's slot.
    finishHung();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fenceOfHung?.holds()).toBe(false);
    expect(next.holds()).toBe(true);
    expect(late).toHaveLength(1);
    expect((late[0] as Error).message).toBe('fenced_out');

    releaseNext();
    await expect(nextRun).resolves.toBe('next-done');
    expect(next.holds()).toBe(false);
  });
});

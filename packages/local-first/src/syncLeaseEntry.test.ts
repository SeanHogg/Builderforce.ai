import { describe, expect, it } from 'vitest';
import {
  createDeviceStoreCoordinatorLease,
  createSyncLease,
  type DeviceStoreCoordinatorLease,
  type SyncLeaseHandle,
  type SyncLeaseOptions,
} from './index.ts';

describe('@builderforce/local-first sync lease package entry', () => {
  it('re-exports createSyncLease with its option and handle types', () => {
    let clock = 20_000;
    const now = (): number => clock;
    const journal = `entry-journal-${crypto.randomUUID()}`;
    const options: SyncLeaseOptions = { owner: 'holder', now, ttlMs: 1_000, journal };
    const held: SyncLeaseHandle = createSyncLease(options);
    const other: SyncLeaseHandle = createSyncLease({ owner: 'other', now, ttlMs: 1_000, journal });

    expect(held.acquire()).toBe(true);
    expect(other.acquire()).toBe(false);
    held.release();
    expect(other.acquire()).toBe(true);
    clock += 1_000;
    expect(held.acquire()).toBe(true);
  });

  it('re-exports createDeviceStoreCoordinatorLease with its handle type', async () => {
    const now = (): number => 50_000;
    const deviceStore = `entry-store-${crypto.randomUUID()}`;
    const held: DeviceStoreCoordinatorLease = createDeviceStoreCoordinatorLease({
      deviceStore,
      now,
      ttlMs: 30_000,
    });
    const other: DeviceStoreCoordinatorLease = createDeviceStoreCoordinatorLease({
      deviceStore,
      now,
      ttlMs: 30_000,
    });
    const separate: DeviceStoreCoordinatorLease = createDeviceStoreCoordinatorLease({
      deviceStore: `entry-store-other-${crypto.randomUUID()}`,
      now,
      ttlMs: 30_000,
    });

    expect(held.holds()).toBe(false);
    let releaseHold: () => void = () => {};
    const running = held.run('holder', () => new Promise<string>((resolve) => {
      releaseHold = () => resolve('held');
    }));
    expect(held.holds()).toBe(true);
    await expect(other.run('other', async () => 'stolen')).resolves.toBeUndefined();
    await expect(separate.run('separate', async () => 'other-store')).resolves.toBe('other-store');
    releaseHold();
    await expect(running).resolves.toBe('held');
    expect(held.holds()).toBe(false);
    await expect(other.run('other', async () => 'taken')).resolves.toBe('taken');
  });
});

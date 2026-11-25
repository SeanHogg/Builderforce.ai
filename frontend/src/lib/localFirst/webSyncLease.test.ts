// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { LeaseLockManager } from '@builderforce/local-first/indexed-db';
import { createWebSyncLease } from './webSyncLease';

/** A Web Locks stand-in: `ifAvailable` hands the callback `null` while the name is held. */
function fakeLocks(): LeaseLockManager {
  const held = new Set<string>();
  return {
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({});
      } finally {
        held.delete(name);
      }
    },
  };
}

describe('web sync lease', () => {
  it('runs the work when the lock is free and hands back its result', async () => {
    const lease = createWebSyncLease({ deviceId: `free-${crypto.randomUUID()}`, locks: fakeLocks() });
    expect(await lease.run('owner', async () => 42)).toBe(42);
  });

  it('does not run the work, and says so, when another tab holds the lock', async () => {
    const locks = fakeLocks();
    const deviceId = `tabs-${crypto.randomUUID()}`;
    const first = createWebSyncLease({ deviceId, locks });
    const second = createWebSyncLease({ deviceId, locks });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = first.run('a', async () => { await gate; return 'a'; });
    const work = vi.fn(async () => 'b');
    expect(await second.run('b', work)).toBeUndefined();
    expect(work).not.toHaveBeenCalled();
    release();
    expect(await running).toBe('a');
    // The lock is free again afterwards.
    expect(await second.run('b', work)).toBe('b');
  });

  it('falls back to the in-tab lease when there are no Web Locks: one run at a time', async () => {
    const lease = createWebSyncLease({ deviceId: `solo-${crypto.randomUUID()}`, locks: null });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = lease.run('a', async () => { await gate; return 1; });
    expect(await lease.run('b', async () => 2)).toBeUndefined();
    release();
    expect(await running).toBe(1);
  });

  it('propagates a failure of the work', async () => {
    const lease = createWebSyncLease({ deviceId: `err-${crypto.randomUUID()}`, locks: fakeLocks() });
    await expect(lease.run('a', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

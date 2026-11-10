import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeFiles } from './fileManifest.js';
import { LOCK_FRESH_MS, LOCK_REFRESH_MS, LOCK_STALE_MS, acquireReplicaLock, fileReplicaLock, lockFileName } from './replicaLock.js';

const ROOT = 'repo/docs';

function memoryFiles(): KnowledgeFiles & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, read: async (n) => data.get(n), write: async (n, t) => { data.set(n, t); } };
}
const record = (files: { data: Map<string, string> }) => JSON.parse(files.data.get(lockFileName(ROOT))!) as { pid: number | string; at: number };

afterEach(() => { vi.useRealTimers(); });

describe("the replica pump's lock", () => {
  it('is named beside the queue file', () => {
    expect(lockFileName(ROOT)).toMatch(/\.replica\.lock$/);
  });

  it('acquires a free lock and writes {pid, at}', async () => {
    const files = memoryFiles();
    const lock = await acquireReplicaLock(files, ROOT, { pid: 1, now: () => 5000 });
    expect(lock).toBeDefined();
    expect(record(files)).toEqual({ pid: 1, at: 5000 });
    await lock!.release();
  });

  it('refuses a second holder while the first is fresh', async () => {
    const files = memoryFiles();
    const first = await acquireReplicaLock(files, ROOT, { pid: 1, now: () => 5000 });
    const second = await acquireReplicaLock(files, ROOT, { pid: 2, now: () => 5000 + LOCK_STALE_MS - 1 });
    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    expect(record(files).pid).toBe(1);
    await first!.release();
  });

  it('refreshes its stamp every 30 s while held, so a live holder never goes stale', async () => {
    vi.useFakeTimers();
    let clock = 10_000;
    const files = memoryFiles();
    const lock = await acquireReplicaLock(files, ROOT, { pid: 1, now: () => clock });
    clock += LOCK_REFRESH_MS;
    await vi.advanceTimersByTimeAsync(LOCK_REFRESH_MS);
    expect(record(files)).toEqual({ pid: 1, at: clock });
    clock += LOCK_REFRESH_MS;
    await vi.advanceTimersByTimeAsync(LOCK_REFRESH_MS);
    expect(record(files).at).toBe(clock);
    // Three minutes in, the refreshed lock is still the first holder's.
    expect(await acquireReplicaLock(files, ROOT, { pid: 2, now: () => clock + 1000 })).toBeUndefined();
    await lock!.release();
  });

  it('is taken over once it is older than 2 minutes (a crashed window never blocks the other)', async () => {
    const files = memoryFiles();
    await acquireReplicaLock(files, ROOT, { pid: 1, now: () => 1000 }); // never refreshed, never released
    const second = await acquireReplicaLock(files, ROOT, { pid: 2, now: () => 1000 + LOCK_STALE_MS + 1 });
    expect(second).toBeDefined();
    expect(record(files).pid).toBe(2);
    await second!.release();
  });

  it('is free again as soon as it is released', async () => {
    const files = memoryFiles();
    const first = await acquireReplicaLock(files, ROOT, { pid: 1, now: () => 1000 });
    await first!.release();
    const second = await acquireReplicaLock(files, ROOT, { pid: 2, now: () => 1001 });
    expect(second).toBeDefined();
    await second!.release();
  });

  it('the same process may re-acquire its own lock', async () => {
    const files = memoryFiles();
    const first = await acquireReplicaLock(files, ROOT, { pid: 1, now: () => 1000 });
    const again = await acquireReplicaLock(files, ROOT, { pid: 1, now: () => 2000 });
    expect(again).toBeDefined();
    await first!.release();
    await again!.release();
  });

  it('regression: a host that stalled past the stale window never stamps over, nor frees, the lock another host took', async () => {
    vi.useFakeTimers();
    let clock = 10_000;
    const files = memoryFiles();
    const a = await acquireReplicaLock(files, ROOT, { pid: 'host-a', now: () => clock });
    expect(a?.lost?.aborted).toBe(false);
    // Host A sleeps (no refresh runs) past the stale window; host B takes the root.
    clock += LOCK_STALE_MS + 1;
    const b = await acquireReplicaLock(files, ROOT, { pid: 'host-b', now: () => clock });
    expect(b).toBeDefined();
    // A wakes: its refresh finds B's stamp, so it loses the lock instead of overwriting it.
    clock += LOCK_REFRESH_MS;
    await vi.advanceTimersByTimeAsync(LOCK_REFRESH_MS);
    expect(a!.lost!.aborted).toBe(true);
    expect(b!.lost!.aborted).toBe(false);
    expect(record(files)).toEqual({ pid: 'host-b', at: clock }); // B's own refresh, not A's
    await a!.release();
    expect(record(files).pid).toBe('host-b'); // A's release never wrote at:0 over B's lock
    expect(await acquireReplicaLock(files, ROOT, { pid: 'host-c', now: () => clock + 1 })).toBeUndefined();
    await b!.release();
    expect(record(files)).toEqual({ pid: 'host-b', at: 0 });
  });

  it('regression: with an exclusive create two hosts racing a stale lock leave exactly one holder', async () => {
    const files = memoryFiles();
    const exclusive = Object.assign(files, {
      createExclusive: async (n: string, t: string) => { await Promise.resolve(); if (files.data.has(n)) return false; files.data.set(n, t); return true; },
      rename: async (from: string, to: string) => {
        await Promise.resolve();
        const t = files.data.get(from);
        if (t === undefined) throw new Error('ENOENT');
        files.data.delete(from); files.data.set(to, t);
      },
      remove: async (n: string) => { files.data.delete(n); },
    });
    await acquireReplicaLock(exclusive, ROOT, { pid: 'crashed', now: () => 1000 }); // never refreshed, never released
    const later = 1000 + LOCK_STALE_MS + 1;
    const [x, y] = await Promise.all([
      acquireReplicaLock(exclusive, ROOT, { pid: 'host-a', now: () => later }),
      acquireReplicaLock(exclusive, ROOT, { pid: 'host-b', now: () => later }),
    ]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    const winner = x ? 'host-a' : 'host-b';
    expect(record(files)).toEqual({ pid: winner, at: later });
    expect(await acquireReplicaLock(exclusive, ROOT, { pid: 'host-c', now: () => later + 1 })).toBeUndefined(); // a fresh lock is refused
    await (x ?? y)!.release();
    expect(files.data.has(lockFileName(ROOT))).toBe(false); // released by removing the file, so the next exclusive create wins
    const next = await acquireReplicaLock(exclusive, ROOT, { pid: 'host-c', now: () => later + 2 });
    expect(next).toBeDefined();
    await next!.release();
  });

  it('regression: two hosts taking over one stale lock where BOTH renames succeed (Windows) still leave exactly one holder', async () => {
    const files = memoryFiles();
    const exclusive = Object.assign(files, {
      createExclusive: async (n: string, t: string) => { await Promise.resolve(); if (files.data.has(n)) return false; files.data.set(n, t); return true; },
      // Reports success even when the source is already gone: the rename arbitrates nothing.
      rename: async (from: string, to: string) => {
        await Promise.resolve();
        const t = files.data.get(from);
        if (t !== undefined) { files.data.delete(from); files.data.set(to, t); }
      },
      remove: async (n: string) => { files.data.delete(n); },
    });
    await acquireReplicaLock(exclusive, ROOT, { pid: 'crashed', now: () => 1000 });
    const later = 1000 + LOCK_STALE_MS + 1;
    for (let round = 0; round < 3; round++) {
      const hosts = await Promise.all(['host-a', 'host-b', 'host-c'].map((pid) => acquireReplicaLock(exclusive, ROOT, { pid, now: () => later + round * LOCK_STALE_MS * 2 })));
      const holders = hosts.filter(Boolean);
      expect(holders).toHaveLength(1);
      expect(files.data.has(lockFileName(ROOT))).toBe(true);
      // Leave the winner's lock to go stale for the next round (never released).
    }
  });

  it('regression: after a stall past the fresh window the holder counts the lock lost and its refresh never rewrites it', async () => {
    vi.useFakeTimers();
    let clock = 10_000;
    const files = memoryFiles();
    const a = await acquireReplicaLock(files, ROOT, { pid: 'host-a', now: () => clock });
    expect(a!.isFresh!()).toBe(true);
    clock += LOCK_FRESH_MS; // asleep: no refresh ran, so the last successful stamp is a refresh short of stale
    expect(a!.isFresh!()).toBe(false); // the pump asks this before each send
    expect(a!.lost!.aborted).toBe(true);
    clock += LOCK_REFRESH_MS;
    await vi.advanceTimersByTimeAsync(LOCK_REFRESH_MS);
    expect(record(files)).toEqual({ pid: 'host-a', at: 10_000 }); // no check-then-write over a host that may have taken over
    await a!.release();
  });

  it('regression: two default-owner hosts in ONE process never take each other\'s lock as their own', async () => {
    const files = memoryFiles();
    const first = await fileReplicaLock().acquire(files, ROOT);
    expect(first).toBeDefined();
    expect(await fileReplicaLock().acquire(files, ROOT)).toBeUndefined();
    await first!.release();
  });

  it('a string owner (a browser tab) holds the lock, refuses another tab and re-acquires its own', async () => {
    const files = memoryFiles();
    const tabA = fileReplicaLock({ owner: 'tab-a', now: () => 5000 });
    const tabB = fileReplicaLock({ owner: 'tab-b', now: () => 5001 });
    const first = await tabA.acquire(files, ROOT);
    expect(record(files)).toEqual({ pid: 'tab-a', at: 5000 });
    expect(await tabB.acquire(files, ROOT)).toBeUndefined();
    const again = await tabA.acquire(files, ROOT);
    expect(again).toBeDefined();
    await first!.release();
    await again!.release();
  });
});

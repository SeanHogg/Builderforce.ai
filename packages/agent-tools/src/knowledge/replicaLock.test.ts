import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeFiles } from './fileManifest.js';
import { LOCK_REFRESH_MS, LOCK_STALE_MS, acquireReplicaLock, fileReplicaLock, lockFileName } from './replicaLock.js';

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

import { describe, expect, it } from 'vitest';
import { replicaLockName, webLocksReplicaLock, type LockManagerLike } from './browserReplica';

/** Exclusive Web Locks over one shared state (= one origin); each `webLocksReplicaLock(manager)` is a tab. */
function fakeLockManager(): LockManagerLike & { held(name: string): boolean } {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const run = async (name: string, cb: (lock: unknown) => unknown): Promise<unknown> => {
    held.add(name);
    try { return await cb({ name }); } finally {
      held.delete(name);
      waiting.get(name)?.shift()?.();
    }
  };
  const request = (name: string, a: unknown, b?: unknown): Promise<unknown> => {
    const options = typeof a === 'function' ? {} : (a as { ifAvailable?: boolean });
    const cb = (typeof a === 'function' ? a : b) as (lock: unknown) => unknown;
    if (!held.has(name)) return run(name, cb);
    if (options.ifAvailable) return Promise.resolve(cb(null));
    return new Promise((resolve, reject) => {
      const queue = waiting.get(name) ?? [];
      queue.push(() => { run(name, cb).then(resolve, reject); });
      waiting.set(name, queue);
    });
  };
  return { request: request as LockManagerLike['request'], held: (name) => held.has(name) };
}

const ROOT = 'web:vfs:7';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('webLocksReplicaLock', () => {
  it('lets only one tab’s pump hold the root', async () => {
    const manager = fakeLockManager();
    const tab1 = webLocksReplicaLock(manager);
    const tab2 = webLocksReplicaLock(manager);
    const first = await tab1.acquire({} as never, ROOT);
    expect(first).toBeDefined();
    expect(await tab2.acquire({} as never, ROOT)).toBeUndefined();
    await first!.release();
    await flush();
    expect(await tab2.acquire({} as never, ROOT)).toBeDefined();
  });

  it('does not deadlock a review in the tab whose pump holds the lock', async () => {
    const manager = fakeLockManager();
    const tab = webLocksReplicaLock(manager);
    const pump = await tab.acquire({} as never, ROOT);
    expect(await tab.exclusive(ROOT, async () => 'reviewed')).toBe('reviewed');
    expect(manager.held(replicaLockName(ROOT))).toBe(true);
    await pump!.release();
    await flush();
    expect(manager.held(replicaLockName(ROOT))).toBe(false);
  });

  it('keeps the lock held while a review runs after the pump releases, and frees it once both are done', async () => {
    const manager = fakeLockManager();
    const tab1 = webLocksReplicaLock(manager);
    const tab2 = webLocksReplicaLock(manager);
    const name = replicaLockName(ROOT);
    const pump = await tab1.acquire({} as never, ROOT);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const review = tab1.exclusive(ROOT, async () => { await gate; return 'done'; });
    await flush();

    await pump!.release();
    await flush();
    expect(manager.held(name)).toBe(true);
    expect(await tab2.acquire({} as never, ROOT)).toBeUndefined();

    finish();
    expect(await review).toBe('done');
    await flush();
    expect(manager.held(name)).toBe(false);
    expect(await tab2.acquire({} as never, ROOT)).toBeDefined();
  });

  it('makes a review in another tab wait for the pump’s release', async () => {
    const manager = fakeLockManager();
    const tab1 = webLocksReplicaLock(manager);
    const tab2 = webLocksReplicaLock(manager);
    const pump = await tab1.acquire({} as never, ROOT);
    let ran = false;
    const review = tab2.exclusive(ROOT, async () => { ran = true; return 1; });
    await flush();
    expect(ran).toBe(false);
    await pump!.release();
    expect(await review).toBe(1);
    expect(ran).toBe(true);
  });
});

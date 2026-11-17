import { describe, expect, it, vi } from 'vitest';
import { EngineActivity } from './engine-activity';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('EngineActivity', () => {
  it('is idle by default and whenIdle resolves immediately', async () => {
    const activity = new EngineActivity();
    expect(activity.isBusy()).toBe(false);
    await expect(activity.whenIdle()).resolves.toBeUndefined();
  });

  it('is busy while run() work is pending and returns the work result', async () => {
    const activity = new EngineActivity();
    const gate = deferred<number>();
    const result = activity.run(() => gate.promise);
    expect(activity.isBusy()).toBe(true);
    gate.resolve(42);
    await expect(result).resolves.toBe(42);
    expect(activity.isBusy()).toBe(false);
  });

  it('is re-entrant: stays busy until the outermost run settles', async () => {
    const activity = new EngineActivity();
    const outer = deferred();
    const inner = deferred();
    const idle = vi.fn();
    const outerRun = activity.run(async () => {
      await activity.run(() => inner.promise);
      await outer.promise;
    });
    void activity.whenIdle().then(idle);

    inner.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(activity.isBusy()).toBe(true);
    expect(idle).not.toHaveBeenCalled();

    outer.resolve();
    await outerRun;
    await Promise.resolve();
    expect(activity.isBusy()).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('decrements on a rejected run and rethrows', async () => {
    const activity = new EngineActivity();
    await expect(activity.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(activity.isBusy()).toBe(false);
    await expect(activity.whenIdle()).resolves.toBeUndefined();
  });

  it('notifies onBusy subscribers on each idle → busy transition only, until unsubscribed', async () => {
    const activity = new EngineActivity();
    const listener = vi.fn();
    const off = activity.onBusy(listener);

    await activity.run(async () => {
      await activity.run(async () => {}); // nested: no second notification
    });
    expect(listener).toHaveBeenCalledTimes(1);

    await activity.run(async () => {});
    expect(listener).toHaveBeenCalledTimes(2);

    off();
    await activity.run(async () => {});
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

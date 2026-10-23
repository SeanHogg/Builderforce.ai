import { describe, expect, it, vi } from 'vitest';
import { SingleFlight } from './singleFlight';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('SingleFlight', () => {
  it('runs identical in-flight work ONCE and hands every follower its own copy', async () => {
    const flight = new SingleFlight<{ n: number }>();
    const gate = deferred<{ n: number }>();
    const work = vi.fn(() => gate.promise);
    const share = vi.fn((leader: { n: number }) => ({ ...leader }));

    const calls = Array.from({ length: 5 }, () => flight.run('k', work, share));
    expect(flight.size).toBe(1);
    gate.resolve({ n: 42 });
    const results = await Promise.all(calls);

    expect(work).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(4);
    expect(results.filter((r) => !r.shared)).toHaveLength(1);
    expect(results.map((r) => r.value.n)).toEqual([42, 42, 42, 42, 42]);
    // Copies, not the leader's object.
    const leader = results.find((r) => !r.shared)!.value;
    for (const r of results.filter((x) => x.shared)) expect(r.value).not.toBe(leader);
    expect(flight.size).toBe(0);
  });

  it('keys are independent', async () => {
    const flight = new SingleFlight<number>();
    const work = vi.fn(async () => 1);
    await Promise.all([flight.run('a', work, (v) => v), flight.run('b', work, (v) => v)]);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('a follower runs its own work when the leader throws — never failed by someone else', async () => {
    const flight = new SingleFlight<string>();
    const gate = deferred<string>();
    let n = 0;
    const work = vi.fn(() => (n++ === 0 ? gate.promise : Promise.resolve('own')));
    const leader = flight.run('k', work, (v) => v);
    const follower = flight.run('k', work, (v) => v);
    gate.reject(new Error('leader aborted'));
    await expect(leader).rejects.toThrow('leader aborted');
    await expect(follower).resolves.toEqual({ value: 'own', shared: false });
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('a follower runs its own work when the leader result is not shareable', async () => {
    const flight = new SingleFlight<string>();
    const gate = deferred<string>();
    let n = 0;
    const work = vi.fn(() => (n++ === 0 ? gate.promise : Promise.resolve('own')));
    const leader = flight.run('k', work, () => null);
    const follower = flight.run('k', work, () => null);
    gate.resolve('failed-upstream');
    expect((await leader).value).toBe('failed-upstream');
    expect(await follower).toEqual({ value: 'own', shared: false });
  });

  it('a request after the flight settled starts a new one (nothing is cached)', async () => {
    const flight = new SingleFlight<number>();
    const work = vi.fn(async () => 7);
    await flight.run('k', work, (v) => v);
    await flight.run('k', work, (v) => v);
    expect(work).toHaveBeenCalledTimes(2);
  });
});

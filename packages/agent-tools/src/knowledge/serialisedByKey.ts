/**
 * knowledge/serialisedByKey.ts — run async jobs one at a time per key.
 *
 * A second job for a key waits for the first to settle (whether it resolved or rejected),
 * then runs; jobs for different keys overlap. A key's chain entry is removed when its tail
 * settles, so the map never outgrows the keys in flight.
 *
 * Not re-entrant: a job that awaits another job on the same key deadlocks (it waits for itself).
 */

const tails = new Map<string, Promise<void>>();

const settledOnly = (): void => undefined;

export function serialisedByKey<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prior = tails.get(key) ?? Promise.resolve();
    // `prior` is a tail (never rejects), so the job always runs once the previous one settled.
    const result = prior.then(job);
    const tail = result.then(settledOnly, settledOnly);
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return result;
}

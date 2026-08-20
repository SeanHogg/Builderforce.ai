import { describe, it, expect, vi } from 'vitest';
import { runBoundedPool, mapWithConcurrency } from './boundedPool';

/**
 * Four sweeps had grown their own copy of this loop and disagreed about the two details
 * that matter — whether there is a deadline, and whether the items it never reached are
 * REPORTED. The second is the one the old serial loops could not produce at all: they ran
 * until the isolate was evicted, so there was no moment at which they knew what they had
 * skipped. These pin both.
 */
describe('runBoundedPool', () => {
  it('runs every item when there is no deadline', async () => {
    const seen: number[] = [];
    const r = await runBoundedPool([1, 2, 3, 4, 5], { limit: 2 }, async (n) => { seen.push(n); });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(r).toEqual({ started: 5, notReached: 0 });
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBoundedPool(Array.from({ length: 20 }, (_, i) => i), { limit: 3 }, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('stops STARTING work past the deadline and reports what it skipped', async () => {
    let clock = 1_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const seen: number[] = [];
      const r = await runBoundedPool(
        [1, 2, 3, 4, 5, 6],
        { limit: 1, deadlineAt: 1_000 + 30 },
        async (n) => { seen.push(n); clock += 10; },
      );
      // Three units at 10ms each fills the 30ms window; the rest are reported, not lost.
      expect(seen).toEqual([1, 2, 3]);
      expect(r).toEqual({ started: 3, notReached: 3 });
    } finally {
      spy.mockRestore();
    }
  });

  it('never abandons a unit it already started — the deadline is checked BEFORE the claim', async () => {
    let clock = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const finished: number[] = [];
      await runBoundedPool(
        [1, 2],
        { limit: 1, deadlineAt: 5 },
        async (n) => { clock += 1_000; finished.push(n); },
      );
      // The first unit ran long past the deadline and still completed in full; only the
      // second was declined. A half-applied merge is the failure this guarantees against.
      expect(finished).toEqual([1]);
    } finally {
      spy.mockRestore();
    }
  });

  it('is a no-op on an empty list', async () => {
    const r = await runBoundedPool([], { limit: 4 }, async () => { throw new Error('unreachable'); });
    expect(r).toEqual({ started: 0, notReached: 0 });
  });
});

describe('mapWithConcurrency', () => {
  it('keeps every answer at its INPUT index, whatever order the pool finished in', async () => {
    const out = await mapWithConcurrency([5, 1, 4, 2], 3, async (n) => {
      await new Promise((res) => setTimeout(res, n));
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20]);
  });
});

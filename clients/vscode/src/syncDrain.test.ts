import { describe, expect, it } from "vitest";
import { drainSync, type DrainRateLimit } from "./syncDrain";

/** A partition of `total` events, `batch` accepted per round; records whether each round pulled. */
function partition(total: number, batch: number) {
  let left = total;
  const pulls: boolean[] = [];
  return {
    pulls,
    rounds: () => pulls.length,
    ports: {
      round: async ({ pull }: { pull: boolean }) => {
        pulls.push(pull);
        const pushed = Math.min(batch, left);
        left -= pushed;
        return { pushed, duplicates: 0 };
      },
      pending: async () => left,
    },
  };
}

describe("drainSync", () => {
  it("keeps pushing batches until the destination has nothing pending — pulling once at each end", async () => {
    const p = partition(250, 100);
    const result = await drainSync(p.ports);
    expect(result).toEqual({ rounds: 3, more: false });
    expect(await p.ports.pending()).toBe(0);
    // The first round pulls, the pushes in between do not, one closing pull reads back the rest.
    expect(p.pulls).toEqual([true, false, false, true]);
  });

  it("runs a single round when one batch covers everything", async () => {
    const p = partition(5, 100);
    expect(await drainSync(p.ports)).toEqual({ rounds: 1, more: false });
    expect(p.pulls).toEqual([true]);
  });

  it("is not capped at a round count: a long queue drains in one pass while the budget lasts", async () => {
    const p = partition(88_000, 100);
    expect(await drainSync(p.ports)).toMatchObject({ rounds: 880, more: false });
  });

  it("stops when a round makes no progress (dependency_pending holds the rest)", async () => {
    let rounds = 0;
    const result = await drainSync({
      round: async () => { rounds += 1; return { pushed: 0, duplicates: 0 }; },
      pending: async () => 4,
    });
    expect(result).toEqual({ rounds: 1, more: false });
    expect(rounds).toBe(1);
  });

  it("counts a falling pending count as progress even with no accepted receipts", async () => {
    let left = 3;
    const result = await drainSync({
      round: async () => { left -= 1; return { pushed: 0, duplicates: 0 }; },
      pending: async () => left,
    });
    expect(result.rounds).toBe(3);
  });

  it("yields when the pass's time budget runs out, reporting more work", async () => {
    let clock = 0;
    const p = partition(10_000, 100);
    const round = p.ports.round;
    const result = await drainSync({ ...p.ports, round: async (o) => { clock += 1_000; return round(o); } }, { maxMs: 5_000, now: () => clock });
    expect(result).toEqual({ rounds: 5, more: true });
  });

  it("leaves the reserve of the tenant's request bucket to the person, resuming at its reset", async () => {
    const p = partition(10_000, 100);
    let limit: DrainRateLimit = { limit: 300, remaining: 299 };
    const round = p.ports.round;
    const result = await drainSync({
      ...p.ports,
      round: async (o) => {
        const summary = await round(o);
        limit = { limit: 300, remaining: limit.remaining - 50, resetAt: new Date(70_000).toISOString() };
        return summary;
      },
      rateLimit: () => limit,
    }, { now: () => 10_000 });
    // 299 → 249 → 199 → 149 (< 150, half of 300): stop after the third round.
    expect(result).toEqual({ rounds: 3, more: true, resumeAfterMs: 60_000 });
  });

  it("a pass that continues a drain does not pull first, and still closes with one pull", async () => {
    const p = partition(250, 100);
    expect(await drainSync(p.ports, { pullFirst: false })).toEqual({ rounds: 3, more: false });
    expect(p.pulls).toEqual([false, false, false, true]);
  });

  it("a nearly spent sliding window still pauses long enough for a burst", async () => {
    const p = partition(10_000, 100);
    const result = await drainSync({ ...p.ports, rateLimit: () => ({ limit: 300, remaining: 10, resetAt: new Date(10_500).toISOString() }) }, { now: () => 10_000 });
    expect(result).toEqual({ rounds: 1, more: true, resumeAfterMs: 10_000 });
  });

  it("stops on a 429 and reports the server's Retry-After", async () => {
    const result = await drainSync({
      round: async () => { throw Object.assign(new Error("sync_http_status"), { status: 429, retryAfterMs: 12_000 }); },
      pending: async () => 50,
    });
    expect(result).toEqual({ rounds: 0, more: true, resumeAfterMs: 12_000 });
  });

  it("any other failure still throws", async () => {
    await expect(drainSync({
      round: async () => { throw Object.assign(new Error("boom"), { status: 500 }); },
      pending: async () => 50,
    })).rejects.toThrow("boom");
  });

  it("stops when the lease is held elsewhere", async () => {
    expect(await drainSync({ round: async () => undefined, pending: async () => 9 })).toEqual({ rounds: 1, more: false });
  });
});

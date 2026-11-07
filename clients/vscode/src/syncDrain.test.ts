import { describe, expect, it } from "vitest";
import { drainSync, MAX_DRAIN_ROUNDS } from "./syncDrain";

/** A partition of `total` events, `batch` accepted per round. */
function partition(total: number, batch: number) {
  let left = total;
  let rounds = 0;
  return {
    rounds: () => rounds,
    ports: {
      round: async () => {
        rounds += 1;
        const pushed = Math.min(batch, left);
        left -= pushed;
        return { pushed, duplicates: 0 };
      },
      pending: async () => left,
    },
  };
}

describe("drainSync", () => {
  it("keeps pushing batches until the destination has nothing pending", async () => {
    const p = partition(250, 100);
    expect(await drainSync(p.ports)).toBe(3);
    expect(await p.ports.pending()).toBe(0);
  });

  it("runs a single round when one batch covers everything", async () => {
    const p = partition(5, 100);
    expect(await drainSync(p.ports)).toBe(1);
  });

  it("stops when a round makes no progress (dependency_pending holds the rest)", async () => {
    let rounds = 0;
    const n = await drainSync({
      round: async () => { rounds += 1; return { pushed: 0, duplicates: 0 }; },
      pending: async () => 4,
    });
    expect(n).toBe(1);
    expect(rounds).toBe(1);
  });

  it("counts a falling pending count as progress even with no accepted receipts", async () => {
    let left = 3;
    const n = await drainSync({
      round: async () => { left -= 1; return { pushed: 0, duplicates: 0 }; },
      pending: async () => left,
    });
    expect(n).toBe(3);
  });

  it("is capped so it can never spin", async () => {
    let rounds = 0;
    await drainSync({
      round: async () => { rounds += 1; return { pushed: 1, duplicates: 0 }; },
      pending: async () => 1_000,
    });
    expect(rounds).toBe(MAX_DRAIN_ROUNDS);
  });

  it("stops when the lease is held elsewhere", async () => {
    expect(await drainSync({ round: async () => undefined, pending: async () => 9 })).toBe(1);
  });
});

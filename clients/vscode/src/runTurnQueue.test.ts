import { afterEach, describe, expect, it, vi } from "vitest";
import { createTurnQueue } from "./runTurnQueue";

/** A fake run store: which keys hold a run, and the listeners watching them. */
function fixture() {
  const running = new Set<number>();
  const live = new Set<number>();
  const ran: string[] = [];
  const listeners = new Map<number, Set<() => void>>();
  const queue = createTurnQueue<string>({
    isRunning: (key) => running.has(key),
    isLive: (key) => live.has(key) || running.has(key),
    subscribe: (key, listener) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => set.delete(listener);
    },
    run: async (spec) => { ran.push(spec); },
    recheckMs: 10,
  });
  return { queue, running, live, ran, listeners };
}

afterEach(() => vi.useRealTimers());

describe("the turns parked behind a live run", () => {
  it("run one at a time, in the order they arrived", async () => {
    const { queue, ran } = fixture();
    const a = queue.park(1, "a");
    const b = queue.park(1, "b");
    const c = queue.park(1, "c");

    queue.settled(1);
    await a;
    expect(ran).toEqual(["a"]);
    queue.settled(1);
    await b;
    queue.settled(1);
    await c;
    expect(ran).toEqual(["a", "b", "c"]);
  });

  it("keep their place when the key is claimed again as the run settles - the head is never re-parked at the tail", async () => {
    const { queue, live, ran } = fixture();
    const a = queue.park(1, "a");
    queue.park(1, "b");

    live.add(1); // a wake started a run before the queue was asked
    queue.settled(1);
    expect(ran).toEqual([]);

    live.delete(1); // that run settled and asks again
    queue.settled(1);
    await a;
    expect(ran).toEqual(["a"]);
  });

  it("are dropped by a Stop, which resolves them without running them - and a turn typed after it survives", async () => {
    const { queue, ran } = fixture();
    const before = queue.park(1, "before the stop");
    queue.drop(1);
    await before;

    const after = queue.park(1, "after the stop");
    queue.settled(1);
    await after;

    expect(ran).toEqual(["after the stop"]);
  });

  it("are settled by dispose, so nothing awaits a host that is gone", async () => {
    const { queue, running, ran } = fixture();
    running.add(2);
    const parked = queue.park(1, "a");
    const idle = queue.whenIdle(2);

    queue.dispose();
    await Promise.all([parked, idle]);
    expect(ran).toEqual([]);
  });
});

describe("waiting for a key to go idle", () => {
  it("ends when the run store says so", async () => {
    const { queue, running, listeners } = fixture();
    running.add(1);
    const idle = queue.whenIdle(1);
    running.delete(1);
    for (const l of listeners.get(1) ?? []) l();
    await idle;
  });

  it("ends when the cell was forgotten (a reset, an eviction) without telling its subscribers", async () => {
    vi.useFakeTimers();
    const { queue, running } = fixture();
    running.add(1);
    let ended = false;
    void queue.whenIdle(1).then(() => { ended = true; });

    running.delete(1); // no listener fires
    await vi.advanceTimersByTimeAsync(25);
    expect(ended).toBe(true);
  });
});

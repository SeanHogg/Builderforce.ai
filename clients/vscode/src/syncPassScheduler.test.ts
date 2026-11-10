import { describe, expect, it } from "vitest";
import { MAX_TIMER_MS, createPassScheduler, type PassOutcome } from "./syncPassScheduler";

/** A fake clock and timer: `tick(ms)` runs every timer due by then. */
function harness(passes: Array<() => Promise<PassOutcome | void>>) {
  let clock = 0;
  const timers: Array<{ at: number; run: () => void; id: number }> = [];
  let ids = 0;
  let runs = 0;
  const scheduler = createPassScheduler({
    pass: () => {
      const next = passes[Math.min(runs, passes.length - 1)]!;
      runs += 1;
      return next();
    },
    enabled: () => true,
    debounceMs: 2_000,
    onError: () => undefined,
    now: () => clock,
    setTimer: (run, ms) => {
      ids += 1;
      timers.push({ at: clock + ms, run, id: ids });
      return ids;
    },
    clearTimer: (id) => {
      const at = timers.findIndex((timer) => timer.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  });
  return {
    scheduler,
    runs: () => runs,
    pendingTimers: () => timers.map((timer) => timer.at),
    async tick(ms: number) {
      clock += ms;
      for (;;) {
        const due = timers.findIndex((timer) => timer.at <= clock);
        if (due < 0) break;
        const [timer] = timers.splice(due, 1);
        timer!.run();
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

describe("createPassScheduler", () => {
  it("regression: a 429 defers the next pass to Retry-After, even with `again` asked during the pass", async () => {
    let release!: () => void;
    const h = harness([
      // The first pass is rate-limited: the next may not start for 30 s.
      () => new Promise<PassOutcome>((resolve) => { release = () => resolve({ resumeAt: 30_000 }); }),
      async () => undefined,
    ]);
    const first = h.scheduler.run();
    // A store change during the pass asks for one more.
    void h.scheduler.run();
    release();
    await first;
    // No second pass ran right away: `again` waits for `resumeAt`.
    expect(h.runs()).toBe(1);
    expect(h.pendingTimers()).toEqual([30_000]);
    // A trigger before then does not start one early either.
    h.scheduler.schedule();
    await h.tick(10_000);
    expect(h.runs()).toBe(1);
    await h.tick(20_000);
    expect(h.runs()).toBe(2);
  });

  it("a deferred pass with work left continues as soon as allowed, without a trigger", async () => {
    const h = harness([async () => ({ resumeAt: 5_000 }), async () => undefined]);
    await h.scheduler.run();
    expect(h.runs()).toBe(1);
    await h.tick(5_000);
    expect(h.runs()).toBe(2);
    expect(h.pendingTimers()).toEqual([]);
  });

  it("single flight: a trigger during a pass runs ONE more pass after it", async () => {
    let release!: () => void;
    const h = harness([() => new Promise<void>((resolve) => { release = resolve; }), async () => undefined]);
    const first = h.scheduler.run();
    void h.scheduler.run();
    void h.scheduler.run();
    release();
    await first;
    expect(h.runs()).toBe(2);
  });

  it("a resumeAt beyond what a timer can hold is clamped, not fired at once", async () => {
    const h = harness([async () => ({ resumeAt: 10 * 2 ** 31 })]);
    await h.scheduler.run();
    expect(h.pendingTimers()).toEqual([MAX_TIMER_MS]);
  });

  it("dispose stops every timer", async () => {
    const h = harness([async () => ({ resumeAt: 5_000 })]);
    await h.scheduler.run();
    h.scheduler.dispose();
    await h.tick(10_000);
    expect(h.runs()).toBe(1);
  });
});

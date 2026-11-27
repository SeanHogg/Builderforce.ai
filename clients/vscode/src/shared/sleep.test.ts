import { describe, expect, it, vi } from "vitest";
import { sleep } from "./sleep";

describe("sleep", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const p = sleep(100).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(99);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves early when the signal aborts", async () => {
    const ac = new AbortController();
    const p = sleep(60_000, ac.signal);
    ac.abort();
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves at once when already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(60_000, ac.signal)).resolves.toBeUndefined();
  });
});

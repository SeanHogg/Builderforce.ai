import { describe, expect, it, vi } from "vitest";
import { retryingLoad } from "./retryingLoad.js";

describe("retryingLoad", () => {
  it("regression: a failed load is not cached for the session — it is retried after the backoff", async () => {
    let now = 1_000;
    const load = retryingLoad<string>({ retryMs: 100, now: () => now });
    const fn = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValue("parser");

    expect(await load("grammar", fn)).toBeNull();
    now += 50; // inside the backoff: not tried again
    expect(await load("grammar", fn)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
    now += 51; // past it: retried, and the success is kept
    expect(await load("grammar", fn)).toBe("parser");
    expect(await load("grammar", fn)).toBe("parser");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("treats a throw (even a synchronous one) as a failure, and shares a load in flight", async () => {
    let now = 0;
    const load = retryingLoad<number>({ retryMs: 10, now: () => now });
    expect(await load("k", () => { throw new Error("wasm"); })).toBeNull();
    now = 11;
    const fn = vi.fn(async () => 7);
    const [a, b] = await Promise.all([load("k", fn), load("k", fn)]);
    expect([a, b]).toEqual([7, 7]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

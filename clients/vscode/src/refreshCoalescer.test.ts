import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefreshCoalescer } from "./refreshCoalescer";

describe("createRefreshCoalescer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Let the microtask that invokes `run` settle. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it("runs an isolated request immediately", async () => {
    const run = vi.fn();
    createRefreshCoalescer(run, 1_000).request();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst inside the window into ONE trailing run", async () => {
    const run = vi.fn();
    const c = createRefreshCoalescer(run, 1_000);
    for (let i = 0; i < 10; i++) c.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    // Nothing pending → the next window closes quietly.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs immediately again once a quiet window has closed", async () => {
    const run = vi.fn();
    const c = createRefreshCoalescer(run, 1_000);
    c.request();
    await vi.advanceTimersByTimeAsync(1_500);
    c.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops the pending trailing run on dispose", async () => {
    const run = vi.fn();
    const c = createRefreshCoalescer(run, 1_000);
    c.request();
    c.request();
    await settle();
    c.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    c.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("swallows a rejected run so the throttle keeps working", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const c = createRefreshCoalescer(run, 1_000);
    c.request();
    c.request();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

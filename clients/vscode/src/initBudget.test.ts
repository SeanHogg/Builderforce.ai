import { afterEach, describe, expect, it, vi } from "vitest";

const logLine = vi.hoisted(() => vi.fn());
vi.mock("./errorReporter", () => ({ logLine }));

import { createInitBudget, createLateRepushLimit } from "./initBudget";

const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("createInitBudget", () => {
  afterEach(() => {
    logLine.mockReset();
    vi.useRealTimers();
  });

  it("returns a step that beats its budget, with no log and no late call", async () => {
    const onLate = vi.fn();
    const budget = createInitBudget(onLate, 50);
    expect(await budget.step("token", Promise.resolve("jwt"), null)).toBe("jwt");
    await later(0, 10);
    expect(logLine).not.toHaveBeenCalled();
    expect(onLate).not.toHaveBeenCalled();
  });

  it("degrades a slow step to its fallback, names it, and fires onLate once when it lands", async () => {
    const onLate = vi.fn();
    const budget = createInitBudget(onLate, 10);
    const [a, b] = await Promise.all([
      budget.step("a", later("A", 40), "fallback-a"),
      budget.step("b", later("B", 45), "fallback-b"),
    ]);
    expect([a, b]).toEqual(["fallback-a", "fallback-b"]);
    expect(logLine).toHaveBeenCalledWith(expect.stringMatching(/^\[init\] a not ready after \d+ms$/));
    await later(0, 80);
    expect(logLine).toHaveBeenCalledWith(expect.stringMatching(/^\[init\] a landed after \d+ms$/));
    expect(logLine).toHaveBeenCalledWith(expect.stringMatching(/^\[init\] b landed after \d+ms$/));
    expect(onLate).toHaveBeenCalledTimes(1);
  });

  it("falls back on a failure, and a late failure neither logs a landing nor re-pushes", async () => {
    const onLate = vi.fn();
    const budget = createInitBudget(onLate, 10);
    expect(await budget.step("x", Promise.reject(new Error("boom")), "safe")).toBe("safe");
    const slowFail = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("late")), 30));
    expect(await budget.step("y", slowFail, "safe")).toBe("safe");
    await later(0, 60);
    expect(logLine).not.toHaveBeenCalledWith(expect.stringContaining("landed"));
    expect(onLate).not.toHaveBeenCalled();
  });

  it("late() fires the callback at most once, for other late sources too", () => {
    const onLate = vi.fn();
    const budget = createInitBudget(onLate);
    budget.late();
    budget.late();
    expect(onLate).toHaveBeenCalledTimes(1);
  });

  it("a soft failure that fulfils late (not an answer) does not re-push", async () => {
    const onLate = vi.fn();
    const budget = createInitBudget(onLate, 10);
    expect(await budget.step("token", later(null as string | null, 30), null, (t) => t !== null)).toBeNull();
    await later(0, 60);
    expect(logLine).not.toHaveBeenCalledWith(expect.stringContaining("landed"));
    expect(onLate).not.toHaveBeenCalled();
    expect(budget.hadLate()).toBe(true);
  });
});

describe("createLateRepushLimit", () => {
  it("caps chained late re-pushes until a build completes with nothing late", () => {
    const limit = createLateRepushLimit(2);
    expect([limit.allow(), limit.allow(), limit.allow()]).toEqual([true, true, false]);
    limit.built(true);
    expect(limit.allow()).toBe(false);
    limit.built(false);
    expect(limit.allow()).toBe(true);
  });
});

describe("createLateRepushLimit.reset", () => {
  it("a user- or host-initiated push starts the budget afresh even while a step stays slow", () => {
    const limit = createLateRepushLimit(1);
    expect(limit.allow()).toBe(true);
    limit.built(true);
    expect(limit.allow()).toBe(false);
    limit.reset();
    expect(limit.allow()).toBe(true);
  });
});

describe("a step that rejects", () => {
  it("falls back and names the failure in the log", async () => {
    logLine.mockReset();
    const budget = createInitBudget(undefined, 50);
    expect(await budget.step("modelRoute", Promise.reject(new Error("no route")), "fallback")).toBe("fallback");
    expect(logLine).toHaveBeenCalledWith("[init] modelRoute failed: no route");
  });
});

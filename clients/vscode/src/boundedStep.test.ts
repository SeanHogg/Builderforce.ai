import { describe, expect, it, vi } from "vitest";
import { boundedStep } from "./boundedStep";

const never = () => new Promise<never>(() => undefined);

describe("boundedStep", () => {
  it("returns the fallback and reports the elapsed ms when the step never answers", async () => {
    const onTimeout = vi.fn();
    expect(await boundedStep(never, 20, { fallback: "fb", onTimeout })).toBe("fb");
    expect(onTimeout).toHaveBeenCalledWith(expect.any(Number));
  });

  it("propagates a failure unless onFail handles it", async () => {
    await expect(boundedStep(async () => { throw new Error("boom"); }, 1000, { fallback: 0 })).rejects.toThrow("boom");
    const onFail = vi.fn();
    expect(await boundedStep(async () => { throw new Error("boom"); }, 1000, { fallback: 0, onFail })).toBe(0);
    expect(onFail).toHaveBeenCalled();
  });

  it("returns an answer in time without calling either hook", async () => {
    const onTimeout = vi.fn();
    expect(await boundedStep(async () => 7, 1000, { fallback: 0, onTimeout })).toBe(7);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("swallows the rejection of a step that fails after its deadline", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let fail!: (e: Error) => void;
    await boundedStep(() => new Promise<never>((_, reject) => { fail = reject; }), 10, { fallback: undefined });
    fail(new Error("late"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

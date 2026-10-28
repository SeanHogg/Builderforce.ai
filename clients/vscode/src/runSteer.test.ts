import { describe, expect, it, vi } from "vitest";
import { createRunSteer, type RunSteerDeps } from "./runSteer";

// A stop while nothing was claimed used to leave a mark that swallowed the NEXT run's
// waiting words; a stop during a run's setup must keep its loop from starting.

function steer(busy: Set<number>) {
  const deps: RunSteerDeps = {
    registry: { lineageOf: () => undefined, interrupt: vi.fn() } as never,
    childHost: { postDirection: vi.fn(), stop: vi.fn(), wake: vi.fn() } as never,
    isBusy: (key) => busy.has(key),
    isSettingUp: () => false,
    ownerName: "BuilderForce",
  };
  return { s: createRunSteer(deps), deps };
}

describe("runSteer.stop", () => {
  it("with nothing claimed, stops nothing and leaves no mark", () => {
    const { s, deps } = steer(new Set());
    s.stop(7);
    expect(deps.childHost.stop).not.toHaveBeenCalled();
    expect(s.stopped(7)).toBe(false);
    // The next run's settle still sends on what waits for it.
    s.settled(7);
    expect(deps.childHost.wake).toHaveBeenCalledWith(7);
  });

  it("while the host has claimed the run (setting up or running), marks it so a loop not yet started never starts, until it settles", () => {
    const { s, deps } = steer(new Set([8]));
    s.stop(8);
    expect(deps.childHost.stop).toHaveBeenCalledWith(8);
    expect(s.stopped(8)).toBe(true);
    s.settled(8);
    expect(s.stopped(8)).toBe(false);
    expect(deps.childHost.wake).not.toHaveBeenCalled();
  });
});

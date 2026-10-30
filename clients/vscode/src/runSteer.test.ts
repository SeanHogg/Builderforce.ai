import { describe, expect, it, vi } from "vitest";
import { drainRunSteering } from "@seanhogg/builderforce-brain-embedded";
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

describe("runSteer.steerTurns - several turns said to a chat's run together", () => {
  it("an IDLE chat takes all of them as ONE continuation: every turn queued in order, one wake", () => {
    const { s, deps } = steer(new Set());
    s.steerTurns(21, [{ text: "first", eventKey: "k1" }, { text: "second", eventKey: "k2" }]);
    expect(deps.childHost.wake).toHaveBeenCalledTimes(1);
    expect(deps.childHost.wake).toHaveBeenCalledWith(21);
    expect(drainRunSteering(21).map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("is idempotent by eventKey: a repeated post is heard once (no second wake, nothing queued twice)", () => {
    const { s, deps } = steer(new Set());
    s.steerTurns(22, [{ text: "once", eventKey: "k1" }]);
    s.steerTurns(22, [{ text: "once", eventKey: "k1" }, { text: "new", eventKey: "k2" }]);
    expect(drainRunSteering(22).map((m) => m.text)).toEqual(["once", "new"]);
    expect(deps.childHost.wake).toHaveBeenCalledTimes(2);
  });

  it("a chat whose run is still unwinding queues them for `settled` and wakes nothing now", () => {
    const { s, deps } = steer(new Set([23]));
    s.steerTurns(23, [{ text: "a", eventKey: "k1" }, { text: "b", eventKey: "k2" }]);
    expect(deps.childHost.wake).not.toHaveBeenCalled();
    expect(drainRunSteering(23).map((m) => m.text)).toEqual(["a", "b"]);
  });

  it("a typed stop among them is the Stop: the turns behind it are not heard", () => {
    const { s, deps } = steer(new Set([24]));
    s.steerTurns(24, [{ text: "STOP executing", eventKey: "k1" }, { text: "never", eventKey: "k2" }]);
    expect(deps.childHost.stop).toHaveBeenCalledWith(24);
    expect(drainRunSteering(24)).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { makeScheduler } from "../src/scheduler";
import { FlowMatchScheduler } from "../src/scheduler/flow-match";

describe("FlowMatchScheduler", () => {
  it("emits a strictly decreasing sigma schedule from 1.0 to 0.0", () => {
    const steps = 8;
    const s = new FlowMatchScheduler(steps);
    expect(s.timestepAt(0)).toBeCloseTo(1.0);
    expect(s.timestepAt(steps)).toBeCloseTo(0.0);
    for (let i = 0; i < steps; i++) {
      expect(s.timestepAt(i)).toBeGreaterThan(s.timestepAt(i + 1));
    }
  });

  it("step() throws until the integration math lands", () => {
    const s = new FlowMatchScheduler(4);
    expect(() => s.step({}, {}, 0)).toThrow(/not yet implemented/);
  });
});

describe("makeScheduler", () => {
  it("constructs a flow-match-rect scheduler", () => {
    const s = makeScheduler("flow-match-rect", 4);
    expect(s).toBeInstanceOf(FlowMatchScheduler);
  });

  it.each(["euler", "dpm++-2m"] as const)(
    "throws for unimplemented scheduler '%s'",
    (kind) => {
      expect(() => makeScheduler(kind, 4)).toThrow(/not yet implemented/);
    },
  );
});

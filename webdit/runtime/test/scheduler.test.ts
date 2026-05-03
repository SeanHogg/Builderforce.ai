import { describe, it, expect } from "vitest";
import { makeScheduler } from "../src/scheduler";
import { FlowMatchScheduler } from "../src/scheduler/flow-match";
import type { MutableTensor } from "../src/types";

const tensor = (data: number[]): MutableTensor => ({
  data: new Float32Array(data),
  dims: [data.length],
});

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

  it("step() applies Euler integration: x -= (sigma_t - sigma_{t+1}) * v", () => {
    const s = new FlowMatchScheduler(4); // sigmas: [1.0, 0.75, 0.5, 0.25, 0.0]
    const latent = tensor([10, 20, 30]);
    const prediction = tensor([1, 2, 3]);
    s.step(latent, prediction, 0); // dt = 0.25
    expect(latent.data[0]).toBeCloseTo(9.75);
    expect(latent.data[1]).toBeCloseTo(19.5);
    expect(latent.data[2]).toBeCloseTo(29.25);
  });

  it("step() at the final step drives latent toward zero noise contribution", () => {
    const s = new FlowMatchScheduler(2); // sigmas: [1.0, 0.5, 0.0]
    const latent = tensor([0]);
    const prediction = tensor([4]);
    s.step(latent, prediction, 0); // dt = 0.5 -> -2
    s.step(latent, prediction, 1); // dt = 0.5 -> -2
    expect(latent.data[0]).toBeCloseTo(-4);
  });

  it("step() throws on length mismatch", () => {
    const s = new FlowMatchScheduler(4);
    expect(() => s.step(tensor([1]), tensor([1, 2]), 0)).toThrow(/length mismatch/);
  });
});

describe("makeScheduler", () => {
  it("constructs a flow-match-rect scheduler", () => {
    expect(makeScheduler("flow-match-rect", 4)).toBeInstanceOf(FlowMatchScheduler);
  });

  it.each(["euler", "dpm++-2m"] as const)(
    "throws for unimplemented scheduler '%s'",
    (kind) => {
      expect(() => makeScheduler(kind, 4)).toThrow(/not yet implemented/);
    },
  );
});

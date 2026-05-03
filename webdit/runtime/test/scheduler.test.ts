import { describe, it, expect } from "vitest";
import { makeScheduler } from "../src/scheduler";
import { EulerScheduler } from "../src/scheduler/euler";
import { FlowMatchScheduler } from "../src/scheduler/flow-match";
import type { MutableTensor } from "../src/types";

const tensor = (data: number[]): MutableTensor => ({
  data: new Float32Array(data),
  dims: [data.length],
});

describe("FlowMatchScheduler", () => {
  it("emits a strictly decreasing sigma schedule from 1.0 to 0.0", () => {
    const s = new FlowMatchScheduler(8);
    expect(s.timestepAt(0)).toBeCloseTo(1.0);
    expect(s.timestepAt(8)).toBeCloseTo(0.0);
    for (let i = 0; i < 8; i++) {
      expect(s.timestepAt(i)).toBeGreaterThan(s.timestepAt(i + 1));
    }
  });

  it("step() applies Euler integration: x -= (sigma_t - sigma_{t+1}) * v", () => {
    const s = new FlowMatchScheduler(4);
    const latent = tensor([10, 20, 30]);
    s.step(latent, tensor([1, 2, 3]), 0); // dt = 0.25
    expect(latent.data[0]).toBeCloseTo(9.75);
    expect(latent.data[1]).toBeCloseTo(19.5);
    expect(latent.data[2]).toBeCloseTo(29.25);
  });

  it("step() across all steps drives latent in the predicted-velocity direction", () => {
    const s = new FlowMatchScheduler(2);
    const latent = tensor([0]);
    s.step(latent, tensor([4]), 0);
    s.step(latent, tensor([4]), 1);
    expect(latent.data[0]).toBeCloseTo(-4);
  });

  it("step() throws on length mismatch", () => {
    const s = new FlowMatchScheduler(4);
    expect(() => s.step(tensor([1]), tensor([1, 2]), 0)).toThrow(/length mismatch/);
  });
});

describe("EulerScheduler (Karras schedule)", () => {
  it("emits a monotonically decreasing sigma schedule ending at 0", () => {
    const s = new EulerScheduler(10);
    for (let i = 0; i < 10; i++) {
      expect(s.timestepAt(i)).toBeGreaterThan(s.timestepAt(i + 1));
    }
    expect(s.timestepAt(10)).toBe(0);
  });

  it("starts near sigmaMax and ends at 0", () => {
    const s = new EulerScheduler(4, 0.002, 14.61, 7.0);
    expect(s.timestepAt(0)).toBeCloseTo(14.61, 1);
    expect(s.timestepAt(4)).toBe(0);
  });

  it("step() with eps=0 is a no-op", () => {
    const s = new EulerScheduler(8);
    const latent = tensor([5, -3, 2]);
    const before = Array.from(latent.data);
    s.step(latent, tensor([0, 0, 0]), 0);
    expect(Array.from(latent.data)).toEqual(before);
  });

  it("step() at the final (sigma=0) step is a no-op (avoids divide by zero)", () => {
    const s = new EulerScheduler(2);
    const latent = tensor([1, 2]);
    const before = Array.from(latent.data);
    s.step(latent, tensor([99, 99]), 2);
    expect(Array.from(latent.data)).toEqual(before);
  });

  it("step() applies x += (sigma_next/sigma - 1) * eps", () => {
    const s = new EulerScheduler(4, 1, 4, 1); // linear-rho schedule, easy math
    const sigma = s.timestepAt(0);
    const sigmaNext = s.timestepAt(1);
    const k = (sigmaNext - sigma) / sigma;
    const latent = tensor([10]);
    s.step(latent, tensor([2]), 0);
    expect(latent.data[0]).toBeCloseTo(10 + k * 2);
  });

  it("rejects steps < 1", () => {
    expect(() => new EulerScheduler(0)).toThrow(/steps/);
  });

  it("step() throws on length mismatch", () => {
    const s = new EulerScheduler(4);
    expect(() => s.step(tensor([1]), tensor([1, 2]), 0)).toThrow(/length mismatch/);
  });
});

describe("makeScheduler", () => {
  it("constructs a flow-match-rect scheduler", () => {
    expect(makeScheduler("flow-match-rect", 4)).toBeInstanceOf(FlowMatchScheduler);
  });

  it("constructs an Euler scheduler", () => {
    expect(makeScheduler("euler", 4)).toBeInstanceOf(EulerScheduler);
  });

  it("throws for unimplemented schedulers", () => {
    expect(() => makeScheduler("dpm++-2m", 4)).toThrow(/not yet implemented/);
  });
});

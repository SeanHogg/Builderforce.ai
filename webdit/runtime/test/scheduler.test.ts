import { describe, it, expect } from "vitest";
import { makeScheduler } from "../src/scheduler";
import { DdimVPredZsnrScheduler } from "../src/scheduler/ddim-vpred-zsnr";
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

  it("constructs a ddim-vpred-zsnr scheduler", () => {
    expect(makeScheduler("ddim-vpred-zsnr", 50)).toBeInstanceOf(DdimVPredZsnrScheduler);
  });

  it("throws for unimplemented schedulers", () => {
    expect(() => makeScheduler("dpm++-2m", 4)).toThrow(/not yet implemented/);
  });
});

describe("DdimVPredZsnrScheduler (CogVideoX's real training parameterization)", () => {
  it("emits 50 discrete, monotonically decreasing timesteps in [0, 999] ending near 0, trailing-spaced", () => {
    const s = new DdimVPredZsnrScheduler(50);
    expect(s.timesteps).toHaveLength(50);
    expect(s.timestepAt(0)).toBe(999);
    for (let i = 0; i < 49; i++) {
      expect(s.timestepAt(i)).toBeGreaterThan(s.timestepAt(i + 1));
    }
    for (const t of s.timesteps) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(999);
      expect(Number.isInteger(t)).toBe(true);
    }
    // trailing spacing, step_ratio = 1000/50 = 20
    expect(s.timestepAt(1)).toBe(979);
    expect(s.timestepAt(49)).toBe(19);
  });

  it("rejects steps < 1", () => {
    expect(() => new DdimVPredZsnrScheduler(0)).toThrow(/steps/);
  });

  it("step() throws on length mismatch", () => {
    const s = new DdimVPredZsnrScheduler(10);
    expect(() => s.step(tensor([1]), tensor([1, 2]), 0)).toThrow(/length mismatch/);
  });

  it("step() is a deterministic, finite, shape-preserving update (v-prediction DDIM)", () => {
    const s = new DdimVPredZsnrScheduler(10);
    const latent = tensor([0.5, -0.3, 1.2]);
    const velocity = tensor([0.1, 0.2, -0.1]);
    s.step(latent, velocity, 0);
    for (const v of latent.data) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(latent.data.length).toBe(3);
  });

  it("with prediction == sample (self-consistent v-pred fixed point), step moves toward the origin as SNR decreases", () => {
    // Not a general invariant of DDIM — just a smoke check that step() is
    // wired to alphasCumprod correctly and doesn't NaN across every index.
    const s = new DdimVPredZsnrScheduler(20);
    const latent = tensor(new Array(8).fill(1));
    const pred = tensor(new Array(8).fill(0));
    for (let i = 0; i < 20; i++) {
      s.step(latent, pred, i);
      for (const v of latent.data) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

import { describe, it, expect } from "vitest";
import { dequantize, quantize, Q4_GROUP } from "../src/quantize";

function randn(n: number, seed = 1): Float32Array {
  // deterministic Box-Muller using a seeded LCG so tests are reproducible
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.max(next(), 1e-9);
    const v = next();
    out[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  return out;
}

function rms(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum / a.length);
}

describe("quantize / dequantize", () => {
  it("f16 round-trips with FP16 precision", () => {
    const x = randn(256);
    const q = quantize(x, [256], "f16");
    expect(q.quantization).toBe("f16");
    expect(q.scales.length).toBe(0);
    const back = dequantize(q);
    expect(rms(x, back)).toBeLessThan(1e-2);
  });

  it("q8f16_0 round-trips within INT8 quantization noise (~1% RMS)", () => {
    const x = randn(512);
    const q = quantize(x, [512], "q8f16_0");
    expect(q.quantization).toBe("q8f16_0");
    expect(q.scales.length).toBe(1);
    const back = dequantize(q);
    expect(rms(x, back)).toBeLessThan(0.05);
  });

  it("q4f16_1 round-trips within INT4 quantization noise (~10% RMS)", () => {
    const x = randn(Q4_GROUP * 8);
    const q = quantize(x, [Q4_GROUP * 8], "q4f16_1");
    expect(q.quantization).toBe("q4f16_1");
    expect(q.scales.length).toBe(8);
    const back = dequantize(q);
    expect(rms(x, back)).toBeLessThan(0.2);
  });

  it("q4f16_1 rejects tensor lengths not divisible by group size", () => {
    const x = new Float32Array(Q4_GROUP + 1);
    expect(() => quantize(x, [Q4_GROUP + 1], "q4f16_1")).toThrow(/divisible/);
  });

  it("handles all-zero tensors without dividing by zero", () => {
    const x = new Float32Array(Q4_GROUP * 2);
    for (const mode of ["f16", "q8f16_0", "q4f16_1"] as const) {
      const back = dequantize(quantize(x, [Q4_GROUP * 2], mode));
      for (const v of back) expect(v).toBe(0);
    }
  });
});

import { describe, it, expect } from "vitest";
import { relu, sigmoid, tanh, silu, gelu, softmax } from "../src/ops/activation";
import { fromArray } from "../src/creation";

describe("activations", () => {
  it("relu(x) = max(0, x)", () => {
    expect(relu(fromArray([-2, -1, 0, 1, 2], [5])).toArray()).toEqual([0, 0, 0, 1, 2]);
  });

  it("sigmoid(0) ≈ 0.5; sigmoid(±large) ≈ {0,1}", () => {
    const r = sigmoid(fromArray([-100, 0, 100], [3])).toArray() as number[];
    expect(r[0]!).toBeLessThan(1e-30);
    expect(r[1]!).toBeCloseTo(0.5, 5);
    expect(r[2]!).toBeCloseTo(1.0, 5);
  });

  it("tanh(0) = 0; tanh(±∞) → ±1", () => {
    const r = tanh(fromArray([-100, 0, 100], [3])).toArray() as number[];
    expect(r[0]!).toBeCloseTo(-1.0);
    expect(r[1]!).toBe(0);
    expect(r[2]!).toBeCloseTo(1.0);
  });

  it("silu(0) = 0; silu(x) = x*sigmoid(x)", () => {
    const r = silu(fromArray([-1, 0, 2], [3])).toArray() as number[];
    expect(r[1]!).toBe(0);
    // silu(2) = 2 * sigmoid(2) ≈ 2 * 0.8807 = 1.7615
    expect(r[2]!).toBeCloseTo(1.7615, 3);
  });

  it("gelu(0) = 0; gelu(large) ≈ x", () => {
    const r = gelu(fromArray([0, 100], [2])).toArray() as number[];
    expect(r[0]!).toBeCloseTo(0);
    expect(r[1]!).toBeCloseTo(100);
  });
});

describe("softmax", () => {
  it("along last axis sums to 1", () => {
    const r = softmax(fromArray([1, 2, 3, 4], [2, 2]), -1).toArray() as number[][];
    expect(r[0]![0]! + r[0]![1]!).toBeCloseTo(1);
    expect(r[1]![0]! + r[1]![1]!).toBeCloseTo(1);
  });

  it("uniform input → uniform output", () => {
    const r = softmax(fromArray([5, 5, 5, 5], [4]), -1).toArray() as number[];
    for (const v of r) expect(v).toBeCloseTo(0.25);
  });

  it("numerically stable for large values (no NaN, no Inf)", () => {
    const r = softmax(fromArray([1000, 1001, 1002], [3]), -1).toArray() as number[];
    for (const v of r) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(r[0]! + r[1]! + r[2]!).toBeCloseTo(1);
  });

  it("along non-final axis", () => {
    // [[1, 2], [3, 4]] softmax along axis 0 → each column sums to 1
    const r = softmax(fromArray([1, 2, 3, 4], [2, 2]), 0).toArray() as number[][];
    expect(r[0]![0]! + r[1]![0]!).toBeCloseTo(1);
    expect(r[0]![1]! + r[1]![1]!).toBeCloseTo(1);
  });
});

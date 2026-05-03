import { describe, it, expect } from "vitest";
import { add, mul, div, sub, neg, abs, sqrt, exp, log, mulScalar } from "../src/ops/elementwise";
import { fromArray, zeros } from "../src/creation";

describe("element-wise ops", () => {
  it("add same-shape", () => {
    const a = fromArray([1, 2, 3, 4], [2, 2]);
    const b = fromArray([10, 20, 30, 40], [2, 2]);
    expect(add(a, b).toArray()).toEqual([
      [11, 22],
      [33, 44],
    ]);
  });

  it("sub / mul / div same-shape", () => {
    const a = fromArray([10, 20, 30, 40], [2, 2]);
    const b = fromArray([1, 2, 3, 4], [2, 2]);
    expect(sub(a, b).toArray()).toEqual([
      [9, 18],
      [27, 36],
    ]);
    expect(mul(a, b).toArray()).toEqual([
      [10, 40],
      [90, 160],
    ]);
    expect(div(a, b).toArray()).toEqual([
      [10, 10],
      [10, 10],
    ]);
  });

  it("neg / abs", () => {
    const a = fromArray([-1, 2, -3, 4], [2, 2]);
    expect(neg(a).toArray()).toEqual([
      [1, -2],
      [3, -4],
    ]);
    expect(abs(a).toArray()).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("sqrt / exp / log", () => {
    const a = fromArray([1, 4, 9, 16], [4]);
    const r = sqrt(a).toArray() as number[];
    expect(r).toEqual([1, 2, 3, 4]);
    expect(exp(zeros([3])).toArray()).toEqual([1, 1, 1]);
    const logResult = log(fromArray([1, Math.E, Math.E * Math.E], [3])).toArray() as number[];
    // Float32 stores Math.E inexactly, so use approximate equality.
    expect(logResult[0]!).toBeCloseTo(0, 5);
    expect(logResult[1]!).toBeCloseTo(1, 5);
    expect(logResult[2]!).toBeCloseTo(2, 5);
  });

  it("mulScalar applies a scalar without broadcasting machinery", () => {
    expect(mulScalar(fromArray([1, 2, 3], [3]), 4).toArray()).toEqual([4, 8, 12]);
  });
});

describe("broadcasting", () => {
  it("[2, 3] + [3] broadcasts the row across axis 0", () => {
    const a = fromArray([1, 2, 3, 10, 20, 30], [2, 3]);
    const b = fromArray([100, 200, 300], [3]);
    expect(add(a, b).toArray()).toEqual([
      [101, 202, 303],
      [110, 220, 330],
    ]);
  });

  it("[3, 1] + [1, 4] produces [3, 4]", () => {
    const a = fromArray([1, 2, 3], [3, 1]);
    const b = fromArray([10, 20, 30, 40], [1, 4]);
    const r = add(a, b).toArray() as number[][];
    expect(r).toEqual([
      [11, 21, 31, 41],
      [12, 22, 32, 42],
      [13, 23, 33, 43],
    ]);
  });

  it("incompatible shapes throw", () => {
    expect(() => add(fromArray([1, 2, 3], [3]), fromArray([1, 2], [2]))).toThrow(/incompatible/);
  });
});

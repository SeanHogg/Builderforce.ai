import { describe, it, expect } from "vitest";
import { sum, mean, max, min } from "../src/ops/reduction";
import { fromArray } from "../src/creation";

describe("reductions", () => {
  it("sum() over all axes returns a scalar", () => {
    const r = sum(fromArray([1, 2, 3, 4], [2, 2])).toArray();
    expect(r).toBe(10);
  });

  it("sum(axis=-1) collapses last dim", () => {
    expect(sum(fromArray([1, 2, 3, 4], [2, 2]), [-1]).toArray()).toEqual([3, 7]);
  });

  it("sum(axis=0) collapses first dim", () => {
    expect(sum(fromArray([1, 2, 3, 4], [2, 2]), [0]).toArray()).toEqual([4, 6]);
  });

  it("keepDims=true preserves rank", () => {
    const r = sum(fromArray([1, 2, 3, 4], [2, 2]), [-1], true).toArray() as number[][];
    expect(r).toEqual([[3], [7]]);
  });

  it("mean reduces and divides", () => {
    expect(mean(fromArray([1, 2, 3, 4], [4])).toArray()).toBe(2.5);
    expect(mean(fromArray([1, 2, 3, 4], [2, 2]), [-1]).toArray()).toEqual([1.5, 3.5]);
  });

  it("max picks the largest", () => {
    expect(max(fromArray([1, 5, 3, 2], [4])).toArray()).toBe(5);
    expect(max(fromArray([1, 5, 3, 2], [2, 2]), [-1]).toArray()).toEqual([5, 3]);
  });

  it("min picks the smallest", () => {
    expect(min(fromArray([4, 5, 3, 2], [4])).toArray()).toBe(2);
  });
});

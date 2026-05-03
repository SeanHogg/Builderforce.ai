import { describe, it, expect } from "vitest";
import { Tensor } from "../src/tensor";
import { fromArray, zeros, ones, full, arange, eye } from "../src/creation";
import { contiguousStrides } from "../src/shape";

describe("Tensor primitives", () => {
  it("contiguous() builds contiguous strides", () => {
    const t = fromArray([1, 2, 3, 4, 5, 6], [2, 3]);
    expect([...t.strides]).toEqual([3, 1]);
    expect(t.isContiguous()).toBe(true);
    expect(t.size).toBe(6);
    expect(t.ndim).toBe(2);
  });

  it("get() reads values by multi-index", () => {
    const t = fromArray([10, 20, 30, 40, 50, 60], [2, 3]);
    expect(t.getF32(0, 0)).toBe(10);
    expect(t.getF32(0, 2)).toBe(30);
    expect(t.getF32(1, 1)).toBe(50);
  });

  it("toArray() returns nested JS arrays", () => {
    const t = fromArray([1, 2, 3, 4], [2, 2]);
    expect(t.toArray()).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("validates shape vs data length on construction", () => {
    expect(() => Tensor.contiguous(new Float32Array([1, 2, 3]), [2, 2], "float32")).toThrow();
  });
});

describe("creation helpers", () => {
  it("zeros / ones / full produce expected values", () => {
    expect(zeros([3]).toArray()).toEqual([0, 0, 0]);
    expect(ones([2, 2]).toArray()).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(full([3], 7).toArray()).toEqual([7, 7, 7]);
  });

  it("arange counts up to N", () => {
    expect(arange(5).toArray()).toEqual([0, 1, 2, 3, 4]);
  });

  it("eye builds an identity matrix", () => {
    expect(eye(3).toArray()).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });
});

describe("shape utilities", () => {
  it("contiguousStrides for [2, 3, 4] is [12, 4, 1]", () => {
    expect(contiguousStrides([2, 3, 4])).toEqual([12, 4, 1]);
  });

  it("contiguousStrides for scalar [] is []", () => {
    expect(contiguousStrides([])).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  reshape,
  transpose,
  permute,
  unsqueeze,
  squeeze,
  expand,
  flatten,
} from "../src/ops/shape";
import { fromArray, ones, arange } from "../src/creation";

describe("reshape", () => {
  it("changes shape without copying", () => {
    const t = fromArray([1, 2, 3, 4, 5, 6], [2, 3]);
    const r = reshape(t, [3, 2]);
    expect(r.toArray()).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("supports a -1 inferred dim", () => {
    const t = arange(12);
    expect(reshape(t, [3, -1]).shape).toEqual([3, 4]);
    expect(reshape(t, [-1, 4]).shape).toEqual([3, 4]);
  });

  it("rejects size mismatch", () => {
    expect(() => reshape(fromArray([1, 2, 3], [3]), [2, 2])).toThrow();
  });
});

describe("transpose / permute", () => {
  it("transpose swaps two axes", () => {
    const t = fromArray([1, 2, 3, 4, 5, 6], [2, 3]);
    const r = transpose(t, 0, 1).toArray() as number[][];
    expect(r).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("permute reorders axes", () => {
    const t = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [2, 3, 2]);
    const r = permute(t, [2, 0, 1]);
    expect(r.shape).toEqual([2, 2, 3]);
    expect((r.toArray() as number[][][])[0]![0]).toEqual([1, 3, 5]);
  });

  it("permute rejects repeated axis", () => {
    expect(() => permute(ones([2, 3]), [0, 0])).toThrow(/repeated/);
  });
});

describe("squeeze / unsqueeze", () => {
  it("unsqueeze inserts a size-1 dim", () => {
    const t = fromArray([1, 2, 3], [3]);
    expect(unsqueeze(t, 0).shape).toEqual([1, 3]);
    expect(unsqueeze(t, 1).shape).toEqual([3, 1]);
  });

  it("squeeze removes size-1 dims", () => {
    const t = ones([1, 3, 1, 2]);
    expect(squeeze(t).shape).toEqual([3, 2]);
    expect(squeeze(t, 0).shape).toEqual([3, 1, 2]);
  });

  it("squeeze of non-1 axis throws", () => {
    expect(() => squeeze(ones([2, 3]), 0)).toThrow();
  });
});

describe("expand", () => {
  it("broadcasts a [1, 3] to [4, 3]", () => {
    const t = fromArray([1, 2, 3], [1, 3]);
    const r = expand(t, [4, 3]).contiguous().toArray() as number[][];
    expect(r).toEqual([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ]);
  });

  it("rejects incompatible expansion", () => {
    expect(() => expand(fromArray([1, 2], [2]), [3])).toThrow();
  });
});

describe("flatten", () => {
  it("flattens all dims by default", () => {
    expect(flatten(ones([2, 3, 4])).shape).toEqual([24]);
  });

  it("flattens a range of dims", () => {
    expect(flatten(ones([2, 3, 4, 5]), 1, 2).shape).toEqual([2, 12, 5]);
  });
});

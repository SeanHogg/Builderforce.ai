import { describe, it, expect } from "vitest";
import { matmul } from "../src/ops/matmul";
import { fromArray, eye, ones } from "../src/creation";

describe("matmul", () => {
  it("2D matmul: [2,3] @ [3,2]", () => {
    const a = fromArray([1, 2, 3, 4, 5, 6], [2, 3]);
    const b = fromArray([7, 8, 9, 10, 11, 12], [3, 2]);
    // [[58, 64], [139, 154]]
    expect(matmul(a, b).toArray()).toEqual([
      [58, 64],
      [139, 154],
    ]);
  });

  it("identity matmul returns input", () => {
    const a = fromArray([1, 2, 3, 4], [2, 2]);
    const I = eye(2);
    expect(matmul(a, I).toArray()).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("batched matmul: [2, 2, 3] @ [2, 3, 2]", () => {
    const a = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [2, 2, 3]);
    const b = fromArray(
      [1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0],
      [2, 3, 2],
    );
    const r = matmul(a, b).toArray() as number[][][];
    // batch 0: [[1,2,3]@[[1,0],[0,1],[0,0]], [4,5,6]@…] = [[1,2],[4,5]]
    expect(r[0]).toEqual([
      [1, 2],
      [4, 5],
    ]);
    // batch 1 of b: [[0,0],[1,1],[0,0]]
    // [[7,8,9]@b1, [10,11,12]@b1] = [[8, 8], [11, 11]]
    expect(r[1]).toEqual([
      [8, 8],
      [11, 11],
    ]);
  });

  it("broadcasts batch dims: [3, 2, 2] @ [1, 2, 2]", () => {
    const a = ones([3, 2, 2]);
    const b = fromArray([1, 0, 0, 1], [1, 2, 2]); // identity broadcast across 3 batches
    const r = matmul(a, b).toArray() as number[][][];
    expect(r).toEqual([
      [
        [1, 1],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 1],
      ],
    ]);
  });

  it("rejects inner-dim mismatch", () => {
    const a = fromArray([1, 2, 3, 4], [2, 2]);
    const b = fromArray([1, 2, 3, 4, 5, 6], [3, 2]);
    expect(() => matmul(a, b)).toThrow(/inner dim/);
  });
});

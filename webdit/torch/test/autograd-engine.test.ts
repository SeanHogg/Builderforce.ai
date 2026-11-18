import { describe, expect, it } from "vitest";
import {
  F,
  UnsupportedOpError,
  intTensor,
  isGradEnabled,
  noGrad,
  optim,
  setGradEnabled,
  tensor,
  type Backend,
} from "../src/autograd";

/** Graph mechanics: grad mode, accumulation, ownership, errors. */

describe("autograd engine", () => {
  it("no_grad records no graph and restores the mode", () => {
    const x = tensor([1, 2], [2], { requiresGrad: true });
    const y = noGrad(() => F.mul(x, x));
    expect(y.requiresGrad).toBe(false);
    expect(y.gradFn).toBeNull();
    expect(isGradEnabled()).toBe(true);
    const prev = setGradEnabled(false);
    expect(F.add(x, x).requiresGrad).toBe(false);
    setGradEnabled(prev);
    expect(F.add(x, x).requiresGrad).toBe(true);
  });

  it("leaf gradients accumulate across backward calls", async () => {
    const x = tensor([1, 2, 3], [3], { requiresGrad: true });
    F.sum(F.mul(x, x)).backward();
    F.sum(F.mul(x, x)).backward();
    expect(Array.from(await x.grad!.data())).toEqual([4, 8, 12]);
  });

  it("a tensor used twice gets the sum of both paths", async () => {
    const x = tensor([2], [1], { requiresGrad: true });
    F.sum(F.add(F.mul(x, x), F.affine(x, 3))).backward();
    expect(Array.from(await x.grad!.data())).toEqual([7]);
  });

  it("each leaf owns its gradient, accumulated in place — the .grad object is stable", async () => {
    const a = tensor([1, 1], [2], { requiresGrad: true });
    const b = tensor([1, 1], [2], { requiresGrad: true });
    F.sum(F.add(a, b)).backward(); // both leaves receive the same upstream gradient
    const aGrad = a.grad;
    F.sum(F.add(a, b)).backward(); // in-place accumulation must not write through to b.grad
    expect(a.grad).toBe(aGrad);
    expect(Array.from(await a.grad!.data())).toEqual([2, 2]);
    expect(Array.from(await b.grad!.data())).toEqual([2, 2]);
    new optim.AdamW([a], { lr: 0.1 }).step();
    expect(Array.from(await a.grad!.data())).toEqual([2, 2]); // PyTorch semantics: step leaves .grad intact
  });

  it("frees the graph after backward: a second backward through it throws (retainGraph allows it)", async () => {
    const x = tensor([3], [1], { requiresGrad: true });
    const h = F.mul(x, x);
    const y = F.sum(h);
    y.backward(undefined, { retainGraph: true });
    y.backward();
    expect(Array.from(await x.grad!.data())).toEqual([12]);
    // Freed, not turned into leaves: the intermediate still reports a grad_fn…
    expect(h.isLeaf).toBe(false);
    expect(y.isLeaf).toBe(false);
    // …and backward through it again is an error, not a silent stop.
    expect(() => y.backward()).toThrow(/backward through the graph a second time/);
    expect(() => F.sum(F.affine(h, 2)).backward()).toThrow(/backward through the graph a second time/);
    expect(Array.from(await x.grad!.data())).toEqual([12]);
  });

  it("frozen inputs get no gradient", () => {
    const w = tensor([1, 2], [2]);
    const x = tensor([3, 4], [2], { requiresGrad: true });
    F.sum(F.mul(w, x)).backward();
    expect(w.grad).toBeNull();
    expect(x.grad).not.toBeNull();
  });

  it("explicit output gradient for non-scalar backward", async () => {
    const x = tensor([1, 2], [2], { requiresGrad: true });
    F.affine(x, 5).backward(tensor([1, -1], [2]));
    expect(Array.from(await x.grad!.data())).toEqual([5, -5]);
  });

  it("rejects implicit backward of a non-scalar and of a graph-free tensor", () => {
    const x = tensor([1, 2], [2], { requiresGrad: true });
    expect(() => F.mul(x, x).backward()).toThrow(/1-element/);
    expect(() => tensor([1], [1]).backward()).toThrow(/does not require grad/);
  });

  it("unsupported surface errors name the op", () => {
    const x = tensor([1, 2, 3, 4], [2, 2]);
    expect(() => F.softmax(x, 0)).toThrow(UnsupportedOpError);
    expect(() => F.softmax(x, 0)).toThrow(/^softmax:/);
    expect(() => F.matmul(tensor([1, 2, 3, 4, 5, 6, 7, 8], [2, 2, 2]), tensor(new Array(12).fill(1), [3, 2, 2]))).toThrow(/^matmul:/);
  });

  it("refuses to mix backends", () => {
    const other = { name: "webgpu" } as unknown as Backend;
    const a = tensor([1], [1]);
    const b = Object.create(a, { backend: { value: other } });
    expect(() => F.add(a, b)).toThrow(/different backends/);
  });

  it("integer tensors cannot require grad; dispose blocks reuse", () => {
    const ids = intTensor([0, 1], [2]);
    expect(() => ids.setRequiresGrad(true)).toThrow(/float32/);
    const x = tensor([1], [1]);
    x.dispose();
    expect(() => F.add(x, x)).toThrow(/dispose/);
  });

  it("toArray / item read back asynchronously", async () => {
    const x = tensor([1, 2, 3, 4, 5, 6], [2, 3]);
    expect(await x.toArray()).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(await F.sum(x).item()).toBe(21);
  });
});

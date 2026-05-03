import { iterIndices, offsetOf } from "../iter";
import { contiguousStrides, normalizeAxes, productOf } from "../shape";
import { Tensor } from "../tensor";

/**
 * Reduce a tensor along the given axes. `keepDims` retains size-1 dims so
 * results broadcast back against the input.
 *
 * Specializations: sum, mean, max. argmax is separate (returns int64).
 */
function reduceF32(
  t: Tensor,
  axes: ReadonlyArray<number>,
  keepDims: boolean,
  init: number,
  combine: (acc: number, v: number) => number,
  finalize: (acc: number, count: number) => number = (a) => a,
): Tensor {
  if (t.dtype !== "float32") throw new Error("reduceF32: float32 only");
  const reduceSet = new Set(normalizeAxes(axes.length === 0 ? t.shape.map((_, i) => i) : axes, t.ndim));

  const outShape: number[] = [];
  const keepShape: number[] = [];
  for (let i = 0; i < t.ndim; i++) {
    if (reduceSet.has(i)) {
      keepShape.push(1);
      if (keepDims) outShape.push(1);
    } else {
      outShape.push(t.shape[i]!);
      keepShape.push(t.shape[i]!);
    }
  }
  const outData = new Float32Array(productOf(keepShape));
  outData.fill(init);
  const outStrides = contiguousStrides(keepShape);
  const aData = t.data as Float32Array;

  let reduceCount = 1;
  for (let i = 0; i < t.ndim; i++) if (reduceSet.has(i)) reduceCount *= t.shape[i]!;

  for (const idx of iterIndices(t.shape)) {
    const src = offsetOf(idx, t.strides, t.offset);
    const projected = idx.map((v, i) => (reduceSet.has(i) ? 0 : v));
    const dst = offsetOf(projected, outStrides, 0);
    outData[dst] = combine(outData[dst]!, aData[src]!);
  }
  for (let i = 0; i < outData.length; i++) outData[i] = finalize(outData[i]!, reduceCount);
  return Tensor.contiguous(outData, outShape, "float32");
}

export function sum(t: Tensor, axes: number[] = [], keepDims = false): Tensor {
  return reduceF32(t, axes, keepDims, 0, (a, v) => a + v);
}

export function mean(t: Tensor, axes: number[] = [], keepDims = false): Tensor {
  return reduceF32(t, axes, keepDims, 0, (a, v) => a + v, (acc, n) => acc / n);
}

export function max(t: Tensor, axes: number[] = [], keepDims = false): Tensor {
  return reduceF32(t, axes, keepDims, -Infinity, (a, v) => (v > a ? v : a));
}

export function min(t: Tensor, axes: number[] = [], keepDims = false): Tensor {
  return reduceF32(t, axes, keepDims, Infinity, (a, v) => (v < a ? v : a));
}

import { iterIndices, offsetOf } from "../iter";
import { contiguousStrides, normalizeAxis, productOf } from "../shape";
import { Tensor } from "../tensor";
import { unaryF32 } from "./elementwise";

export const relu = (a: Tensor) => unaryF32(a, (x) => (x > 0 ? x : 0), "relu");
export const sigmoid = (a: Tensor) => unaryF32(a, (x) => 1 / (1 + Math.exp(-x)), "sigmoid");
export const tanh = (a: Tensor) => unaryF32(a, (x) => Math.tanh(x), "tanh");
export const silu = (a: Tensor) => unaryF32(a, (x) => x / (1 + Math.exp(-x)), "silu");

/** Tanh approximation of GELU — matches PyTorch nn.GELU(approximate="tanh"). */
export const gelu = (a: Tensor) =>
  unaryF32(
    a,
    (x) => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x))),
    "gelu",
  );

/**
 * Numerically-stable softmax along an axis: subtract max, exp, divide by sum.
 */
export function softmax(t: Tensor, axis: number): Tensor {
  if (t.dtype !== "float32") throw new Error("softmax: float32 only");
  const ax = normalizeAxis(axis, t.ndim);
  const out = new Float32Array(t.size);
  const oS = contiguousStrides(t.shape);
  const aData = t.data as Float32Array;

  // Iterate over all positions outside the softmax axis; for each, walk the axis.
  const outerShape = t.shape.map((_, i) => (i === ax ? 1 : t.shape[i]!));
  const axisSize = t.shape[ax]!;
  const axisStride = t.strides[ax]!;

  for (const outer of iterIndices(outerShape)) {
    const baseSrc = offsetOf(outer, t.strides, t.offset);
    const baseDst = offsetOf(outer, oS, 0);
    let m = -Infinity;
    for (let i = 0; i < axisSize; i++) {
      const v = aData[baseSrc + i * axisStride]!;
      if (v > m) m = v;
    }
    let sum = 0;
    const baseDstAx = baseDst;
    const dstStride = oS[ax]!;
    for (let i = 0; i < axisSize; i++) {
      const e = Math.exp(aData[baseSrc + i * axisStride]! - m);
      out[baseDstAx + i * dstStride] = e;
      sum += e;
    }
    for (let i = 0; i < axisSize; i++) out[baseDstAx + i * dstStride]! /= sum;
  }
  return Tensor.contiguous(out, t.shape, "float32");
}

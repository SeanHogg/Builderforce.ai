import { newTypedArray } from "../dtype";
import { iterIndices, offsetOf } from "../iter";
import { broadcastShape, broadcastStrides, contiguousStrides, productOf } from "../shape";
import { Tensor } from "../tensor";

type ScalarFn = (x: number, y: number) => number;
type UnaryFn = (x: number) => number;

/** Float32 binary elementwise with broadcasting. Single hot path for add/sub/mul/div/pow. */
export function binaryF32(a: Tensor, b: Tensor, fn: ScalarFn, opName: string): Tensor {
  if (a.dtype !== "float32" || b.dtype !== "float32") {
    throw new Error(`${opName}: float32 only (got ${a.dtype} and ${b.dtype})`);
  }
  const outShape = broadcastShape(a.shape, b.shape);
  const outData = new Float32Array(productOf(outShape));
  const aS = broadcastStrides(a.shape, outShape, a.strides);
  const bS = broadcastStrides(b.shape, outShape, b.strides);
  const oS = contiguousStrides(outShape);
  const aData = a.data as Float32Array;
  const bData = b.data as Float32Array;

  if (outShape.length === 0) {
    outData[0] = fn(aData[a.offset]!, bData[b.offset]!);
    return Tensor.contiguous(outData, outShape, "float32");
  }
  for (const idx of iterIndices(outShape)) {
    const ai = offsetOf(idx, aS, a.offset);
    const bi = offsetOf(idx, bS, b.offset);
    const oi = offsetOf(idx, oS, 0);
    outData[oi] = fn(aData[ai]!, bData[bi]!);
  }
  return Tensor.contiguous(outData, outShape, "float32");
}

export function unaryF32(a: Tensor, fn: UnaryFn, opName: string): Tensor {
  if (a.dtype !== "float32") throw new Error(`${opName}: float32 only (got ${a.dtype})`);
  const outData = new Float32Array(a.size);
  const oS = contiguousStrides(a.shape);
  const aData = a.data as Float32Array;
  for (const idx of iterIndices(a.shape)) {
    outData[offsetOf(idx, oS, 0)] = fn(aData[offsetOf(idx, a.strides, a.offset)]!);
  }
  return Tensor.contiguous(outData, a.shape, "float32");
}

export const add = (a: Tensor, b: Tensor) => binaryF32(a, b, (x, y) => x + y, "add");
export const sub = (a: Tensor, b: Tensor) => binaryF32(a, b, (x, y) => x - y, "sub");
export const mul = (a: Tensor, b: Tensor) => binaryF32(a, b, (x, y) => x * y, "mul");
export const div = (a: Tensor, b: Tensor) => binaryF32(a, b, (x, y) => x / y, "div");
export const pow = (a: Tensor, b: Tensor) => binaryF32(a, b, (x, y) => Math.pow(x, y), "pow");

export const neg = (a: Tensor) => unaryF32(a, (x) => -x, "neg");
export const abs = (a: Tensor) => unaryF32(a, (x) => Math.abs(x), "abs");
export const sqrt = (a: Tensor) => unaryF32(a, (x) => Math.sqrt(x), "sqrt");
export const exp = (a: Tensor) => unaryF32(a, (x) => Math.exp(x), "exp");
export const log = (a: Tensor) => unaryF32(a, (x) => Math.log(x), "log");

/** Scalar-in-scalar-out broadcast: a * scalar, a + scalar, etc. */
export function scalar(value: number, dtype: "float32" = "float32"): Tensor {
  const d = newTypedArray(dtype, 1) as Float32Array;
  d[0] = value;
  return Tensor.contiguous(d, [], "float32");
}

export function addScalar(a: Tensor, s: number): Tensor {
  return unaryF32(a, (x) => x + s, "addScalar");
}
export function mulScalar(a: Tensor, s: number): Tensor {
  return unaryF32(a, (x) => x * s, "mulScalar");
}

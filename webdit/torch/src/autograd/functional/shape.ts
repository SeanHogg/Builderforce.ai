import { contiguousStrides, normalizeAxis, productOf } from "../../shape";
import type { EngineDType } from "../../backend/backend";
import { DeviceTensor } from "../device-tensor";
import { carryHostIndices } from "../index-check";
import { backendOf, record } from "../record";

/** Shape ops with grad rules. Engine tensors are contiguous, so transpose materializes. */

export function reshape(x: DeviceTensor, shape: readonly number[]): DeviceTensor {
  const be = backendOf("reshape", x);
  const inferred = shape.indexOf(-1);
  const resolved = [...shape];
  if (inferred !== -1) {
    const known = productOf(shape.filter((_, i) => i !== inferred));
    resolved[inferred] = known === 0 ? 0 : x.size / known;
  }
  if (productOf(resolved) !== x.size) {
    throw new Error(`reshape: ${JSON.stringify(shape)} does not hold ${x.size} elements`);
  }
  const out = record("reshape", be.reshape(x.handle, resolved), [x], (gy) => [be.reshape(gy, x.shape)], [], []);
  return carryHostIndices(x, out);
}

/**
 * float32 ⇄ int32 (`.float()` / `.long()`); float → int truncates toward zero.
 * Graph-free, as in PyTorch: an integer result carries no gradient and an
 * integer input has none to receive. Same dtype is a view that keeps the graph.
 */
export function cast(x: DeviceTensor, dtype: EngineDType): DeviceTensor {
  if (x.dtype === dtype) return reshape(x, x.shape);
  const be = backendOf("cast", x);
  return new DeviceTensor(be, be.cast(x.handle, dtype), false);
}

function swapped(x: DeviceTensor, a: number, b: number): { shape: number[]; strides: number[] } {
  const shape = [...x.shape];
  const strides = contiguousStrides(x.shape);
  [shape[a], shape[b]] = [shape[b]!, shape[a]!];
  [strides[a], strides[b]] = [strides[b]!, strides[a]!];
  return { shape, strides };
}

export function transpose(x: DeviceTensor, dim0 = -2, dim1 = -1): DeviceTensor {
  const be = backendOf("transpose", x);
  const a = normalizeAxis(dim0, x.ndim);
  const b = normalizeAxis(dim1, x.ndim);
  const { shape, strides } = swapped(x, a, b);
  const out = be.stridedCopy(x.handle, shape, strides, 0);
  return record("transpose", out, [x], (gy) => {
    const back = [...shape];
    const gStrides = contiguousStrides(shape);
    [back[a], back[b]] = [back[b]!, back[a]!];
    [gStrides[a], gStrides[b]] = [gStrides[b]!, gStrides[a]!];
    return [be.stridedCopy(gy, back, gStrides, 0)];
  }, [], []);
}

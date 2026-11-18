import { contiguousStrides, normalizeAxis, productOf } from "../../shape";
import type { DeviceTensor } from "../device-tensor";
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
  return record("reshape", be.reshape(x.handle, resolved), [x], (gy) => [be.reshape(gy, x.shape)]);
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
  });
}

import { iterIndices, offsetOf } from "../iter";
import { contiguousStrides, normalizeAxis, productOf, type Shape } from "../shape";
import { Tensor, materialize } from "../tensor";

/**
 * Reshape — only allowed for contiguous tensors. Throws otherwise (call
 * `.contiguous()` first). Supports a single -1 dim to be inferred.
 */
export function reshape(t: Tensor, newShape: ReadonlyArray<number>): Tensor {
  const resolved = resolveInferred(newShape, t.size);
  if (productOf(resolved) !== t.size) {
    throw new Error(
      `reshape: new shape ${JSON.stringify(resolved)} (size ${productOf(resolved)}) doesn't match input size ${t.size}`,
    );
  }
  if (!t.isContiguous()) {
    return reshape(materialize(t), resolved);
  }
  return new Tensor(t.data, resolved, contiguousStrides(resolved), t.offset, t.dtype);
}

function resolveInferred(shape: ReadonlyArray<number>, totalSize: number): number[] {
  const inferred = shape.indexOf(-1);
  if (inferred === -1) return [...shape];
  if (shape.lastIndexOf(-1) !== inferred) {
    throw new Error("reshape: at most one dimension may be -1");
  }
  let known = 1;
  for (let i = 0; i < shape.length; i++) if (i !== inferred) known *= shape[i]!;
  if (known === 0 || totalSize % known !== 0) {
    throw new Error(`reshape: cannot infer dimension for shape ${JSON.stringify(shape)}`);
  }
  const copy = [...shape];
  copy[inferred] = totalSize / known;
  return copy;
}

/** Swap two axes (no copy). */
export function transpose(t: Tensor, axisA: number, axisB: number): Tensor {
  const a = normalizeAxis(axisA, t.ndim);
  const b = normalizeAxis(axisB, t.ndim);
  if (a === b) return t;
  const shape = [...t.shape];
  const strides = [...t.strides];
  [shape[a], shape[b]] = [shape[b]!, shape[a]!];
  [strides[a], strides[b]] = [strides[b]!, strides[a]!];
  return new Tensor(t.data, shape, strides, t.offset, t.dtype);
}

/** Permute axes (no copy). */
export function permute(t: Tensor, axes: ReadonlyArray<number>): Tensor {
  if (axes.length !== t.ndim) {
    throw new Error(`permute: got ${axes.length} axes for ${t.ndim}D tensor`);
  }
  const seen = new Set<number>();
  const norm = axes.map((a) => normalizeAxis(a, t.ndim));
  for (const a of norm) {
    if (seen.has(a)) throw new Error(`permute: axis ${a} repeated`);
    seen.add(a);
  }
  const shape = norm.map((a) => t.shape[a]!);
  const strides = norm.map((a) => t.strides[a]!);
  return new Tensor(t.data, shape, strides, t.offset, t.dtype);
}

export function unsqueeze(t: Tensor, axis: number): Tensor {
  const a = axis < 0 ? axis + t.ndim + 1 : axis;
  if (a < 0 || a > t.ndim) {
    throw new Error(`unsqueeze: axis ${axis} out of range for ${t.ndim}D tensor`);
  }
  const shape = [...t.shape.slice(0, a), 1, ...t.shape.slice(a)];
  const strides = [...t.strides.slice(0, a), 0, ...t.strides.slice(a)];
  return new Tensor(t.data, shape, strides, t.offset, t.dtype);
}

export function squeeze(t: Tensor, axis?: number): Tensor {
  if (axis === undefined) {
    const newShape: number[] = [];
    const newStrides: number[] = [];
    for (let i = 0; i < t.ndim; i++) {
      if (t.shape[i] !== 1) {
        newShape.push(t.shape[i]!);
        newStrides.push(t.strides[i]!);
      }
    }
    return new Tensor(t.data, newShape, newStrides, t.offset, t.dtype);
  }
  const a = normalizeAxis(axis, t.ndim);
  if (t.shape[a] !== 1) {
    throw new Error(`squeeze: axis ${a} has size ${t.shape[a]}, not 1`);
  }
  const shape = [...t.shape.slice(0, a), ...t.shape.slice(a + 1)];
  const strides = [...t.strides.slice(0, a), ...t.strides.slice(a + 1)];
  return new Tensor(t.data, shape, strides, t.offset, t.dtype);
}

/** Broadcast tensor to a larger shape (zero-stride trick, no copy). */
export function expand(t: Tensor, newShape: Shape): Tensor {
  if (newShape.length < t.ndim) {
    throw new Error(`expand: target shape ${JSON.stringify(newShape)} has fewer dims than ${t.ndim}D tensor`);
  }
  const offset = newShape.length - t.ndim;
  const shape: number[] = [];
  const strides: number[] = [];
  for (let i = 0; i < newShape.length; i++) {
    if (i < offset) {
      shape.push(newShape[i]!);
      strides.push(0);
    } else {
      const sv = t.shape[i - offset]!;
      const tv = newShape[i]!;
      if (sv === tv) {
        shape.push(sv);
        strides.push(t.strides[i - offset]!);
      } else if (sv === 1) {
        shape.push(tv);
        strides.push(0);
      } else {
        throw new Error(`expand: cannot broadcast dim ${sv} to ${tv} at axis ${i - offset}`);
      }
    }
  }
  return new Tensor(t.data, shape, strides, t.offset, t.dtype);
}

export function flatten(t: Tensor, startDim = 0, endDim = -1): Tensor {
  const start = normalizeAxis(startDim, t.ndim);
  const end = normalizeAxis(endDim, t.ndim);
  if (start > end) throw new Error(`flatten: startDim ${start} > endDim ${end}`);
  let merged = 1;
  for (let i = start; i <= end; i++) merged *= t.shape[i]!;
  const shape = [...t.shape.slice(0, start), merged, ...t.shape.slice(end + 1)];
  return reshape(t, shape);
}

/** Materialize then build a contiguous view with the given shape. */
export { materialize as contiguous } from "../tensor";

/**
 * Shape, stride, and broadcasting utilities. PyTorch / NumPy semantics:
 *   - shapes broadcast trailing dims: (3, 1, 5) and (4, 5) → (3, 4, 5)
 *   - a dim of 1 broadcasts to any size; mismatched non-1 dims throw
 *   - "stride 0" is the standard trick for broadcast — repeats the same value
 */

export type Shape = readonly number[];

export function productOf(shape: Shape): number {
  let p = 1;
  for (const d of shape) p *= d;
  return p;
}

export function contiguousStrides(shape: Shape): number[] {
  const n = shape.length;
  const strides = new Array<number>(n);
  let acc = 1;
  for (let i = n - 1; i >= 0; i--) {
    strides[i] = acc;
    acc *= shape[i]!;
  }
  return strides;
}

export function shapesEqual(a: Shape, b: Shape): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Broadcast two shapes to a common shape (right-aligned). Throws if any pair
 * of dims is incompatible (neither is 1 and they're unequal).
 */
export function broadcastShape(a: Shape, b: Shape): number[] {
  const n = Math.max(a.length, b.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const ai = i - (n - a.length);
    const bi = i - (n - b.length);
    const av = ai >= 0 ? a[ai]! : 1;
    const bv = bi >= 0 ? b[bi]! : 1;
    if (av === bv) out[i] = av;
    else if (av === 1) out[i] = bv;
    else if (bv === 1) out[i] = av;
    else
      throw new Error(
        `broadcastShape: incompatible dim ${av} vs ${bv} at index ${i} (shapes ${JSON.stringify(a)} vs ${JSON.stringify(b)})`,
      );
  }
  return out;
}

/**
 * Compute the strides used to read tensor `srcShape` (with strides
 * `srcStrides`) as if it were `targetShape`. Broadcast dims get stride 0;
 * leading new axes get stride 0.
 */
export function broadcastStrides(srcShape: Shape, targetShape: Shape, srcStrides: Shape): number[] {
  const out = new Array<number>(targetShape.length);
  const offset = targetShape.length - srcShape.length;
  if (offset < 0) {
    throw new Error(
      `broadcastStrides: source shape ${JSON.stringify(srcShape)} has more dims than target ${JSON.stringify(targetShape)}`,
    );
  }
  for (let i = 0; i < offset; i++) out[i] = 0;
  for (let i = 0; i < srcShape.length; i++) {
    const sv = srcShape[i]!;
    const tv = targetShape[i + offset]!;
    if (sv === tv) out[i + offset] = srcStrides[i]!;
    else if (sv === 1) out[i + offset] = 0;
    else
      throw new Error(
        `broadcastStrides: cannot broadcast dim ${sv} to ${tv} at axis ${i}`,
      );
  }
  return out;
}

/** Normalize a possibly-negative axis index to its positive equivalent. */
export function normalizeAxis(axis: number, ndim: number): number {
  const a = axis < 0 ? axis + ndim : axis;
  if (a < 0 || a >= ndim) {
    throw new Error(`normalizeAxis: axis ${axis} out of range for ndim ${ndim}`);
  }
  return a;
}

export function normalizeAxes(axes: ReadonlyArray<number>, ndim: number): number[] {
  return axes.map((a) => normalizeAxis(a, ndim));
}

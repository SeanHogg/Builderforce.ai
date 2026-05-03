import { type AnyTypedArray, type DType, newTypedArray } from "./dtype";
import { iterIndices, offsetOf } from "./iter";
import {
  contiguousStrides,
  productOf,
  shapesEqual,
  type Shape,
} from "./shape";

/**
 * Strided tensor view. Like PyTorch / NumPy, the shape and strides describe
 * how to walk an underlying typed-array buffer; transpose / permute /
 * unsqueeze return new views without copying. `contiguous()` materializes
 * a fresh buffer in row-major layout.
 */
export class Tensor {
  constructor(
    readonly data: AnyTypedArray,
    readonly shape: Shape,
    readonly strides: Shape,
    readonly offset: number,
    readonly dtype: DType,
  ) {
    if (shape.length !== strides.length) {
      throw new Error(
        `Tensor: shape (${shape.length}D) and strides (${strides.length}D) must match`,
      );
    }
  }

  static contiguous(data: AnyTypedArray, shape: Shape, dtype: DType): Tensor {
    const expected = productOf(shape);
    if (data.length !== expected) {
      throw new Error(
        `Tensor.contiguous: data length ${data.length} != product(shape)=${expected}`,
      );
    }
    return new Tensor(data, shape, contiguousStrides(shape), 0, dtype);
  }

  get ndim(): number {
    return this.shape.length;
  }

  get size(): number {
    return productOf(this.shape);
  }

  isContiguous(): boolean {
    if (this.offset !== 0) return false;
    return shapesEqual(this.strides, contiguousStrides(this.shape));
  }

  /** Materialize a fresh row-major buffer. No-op if already contiguous. */
  contiguous(): Tensor {
    if (this.isContiguous() && this.data.length === this.size) return this;
    return materialize(this);
  }

  /**
   * Read a single element at the given multi-index. Mostly useful for tests
   * and small debug paths — hot loops should iterate strides directly.
   */
  get(...idx: number[]): number | bigint {
    if (idx.length !== this.ndim) {
      throw new Error(`get: expected ${this.ndim} indices, got ${idx.length}`);
    }
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i]!;
      if (v < 0 || v >= this.shape[i]!) {
        throw new Error(`get: index ${v} out of range for dim ${i} (size ${this.shape[i]})`);
      }
    }
    const off = offsetOf(idx, this.strides, this.offset);
    return (this.data as { [k: number]: number | bigint })[off]!;
  }

  /** Float32 read, throws if dtype isn't float32. */
  getF32(...idx: number[]): number {
    if (this.dtype !== "float32") throw new Error(`getF32: dtype is ${this.dtype}`);
    return this.get(...idx) as number;
  }

  /** Snapshot to a JS number[] (or nested arrays). Tests + debug only. */
  toArray(): unknown {
    if (this.ndim === 0) {
      return Number(this.get() as number | bigint);
    }
    return toArrayRec(this, 0, this.offset);
  }
}

function toArrayRec(t: Tensor, dim: number, base: number): unknown {
  const size = t.shape[dim]!;
  const stride = t.strides[dim]!;
  const out: unknown[] = new Array(size);
  if (dim === t.ndim - 1) {
    for (let i = 0; i < size; i++) {
      const v = (t.data as { [k: number]: number | bigint })[base + i * stride]!;
      out[i] = typeof v === "bigint" ? Number(v) : v;
    }
  } else {
    for (let i = 0; i < size; i++) {
      out[i] = toArrayRec(t, dim + 1, base + i * stride);
    }
  }
  return out;
}

export function materialize(t: Tensor): Tensor {
  const out = newTypedArray(t.dtype, t.size);
  if (t.ndim === 0) {
    (out as { [k: number]: number | bigint })[0] = (t.data as { [k: number]: number | bigint })[t.offset]!;
    return new Tensor(out, t.shape, [], 0, t.dtype);
  }
  const cs = contiguousStrides(t.shape);
  for (const idx of iterIndices(t.shape)) {
    const src = offsetOf(idx, t.strides, t.offset);
    const dst = offsetOf(idx, cs, 0);
    (out as { [k: number]: number | bigint })[dst] = (t.data as { [k: number]: number | bigint })[src]!;
  }
  return new Tensor(out, t.shape, cs, 0, t.dtype);
}

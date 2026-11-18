import { productOf, type Shape } from "../../shape";
import type { BackendTensor, EngineDType } from "../backend";

/**
 * A WebGPU backend handle: a shape over a refcounted, pooled `GPUBuffer`.
 * Contiguous row-major always. `reshape` shares the storage (refs + 1); the
 * buffer returns to the pool when the last handle over it is released.
 *
 * `float16` is a storage-only label (`WebGPUBackend.toF16`): the logical shape
 * is kept, the buffer holds the values packed two per word, and no compute op
 * accepts it — `fromF16` turns it back into float32.
 */
export interface GpuStorage {
  readonly buffer: GPUBuffer;
  refs: number;
}

export type GpuDType = EngineDType | "float16";

export class GpuTensor implements BackendTensor {
  released = false;

  constructor(
    readonly storage: GpuStorage,
    readonly shape: Shape,
    readonly dtype: GpuDType,
  ) {}

  get size(): number {
    return productOf(this.shape);
  }

  /** Exact byte length of the data (≥ 4 so an empty tensor still binds). */
  get bytes(): number {
    return Math.max(4, dataBytes(this.shape, this.dtype));
  }

  get buffer(): GPUBuffer {
    if (this.released) throw new Error("GpuTensor: used after release");
    return this.storage.buffer;
  }
}

/** Bytes a tensor's values occupy: 4 per element, or 4 per PAIR for packed fp16. */
export function dataBytes(shape: Shape, dtype: GpuDType): number {
  const n = productOf(shape);
  return dtype === "float16" ? Math.ceil(n / 2) * 4 : n * 4;
}

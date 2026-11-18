import { productOf, type Shape } from "../../shape";
import type { BackendTensor, EngineDType } from "../backend";

/**
 * A WebGPU backend handle: a shape over a refcounted, pooled `GPUBuffer`.
 * Contiguous row-major always. `reshape` shares the storage (refs + 1); the
 * buffer returns to the pool when the last handle over it is released.
 */
export interface GpuStorage {
  readonly buffer: GPUBuffer;
  refs: number;
}

export class GpuTensor implements BackendTensor {
  released = false;

  constructor(
    readonly storage: GpuStorage,
    readonly shape: Shape,
    readonly dtype: EngineDType,
  ) {}

  get size(): number {
    return productOf(this.shape);
  }

  /** Exact byte length of the data (≥ 4 so an empty tensor still binds). */
  get bytes(): number {
    return Math.max(4, this.size * 4);
  }

  get buffer(): GPUBuffer {
    if (this.released) throw new Error("GpuTensor: used after release");
    return this.storage.buffer;
  }
}

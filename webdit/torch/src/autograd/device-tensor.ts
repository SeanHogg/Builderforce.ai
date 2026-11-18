import type { Backend, BackendTensor, HostArray } from "../backend/backend";
import { productOf, type Shape } from "../shape";
import { runBackward } from "./engine";

/**
 * A node of the recorded graph: the op that produced a tensor, its inputs, and
 * its grad rule. `backward` receives the output gradient and returns one
 * gradient per input (null where an input needs none). Every handle it returns
 * is owned by the caller — a fresh result or a `backend.reshape` view, never
 * the incoming gradient object itself.
 */
export interface GradNode {
  readonly name: string;
  readonly inputs: readonly DeviceTensor[];
  backward(gy: BackendTensor): Array<BackendTensor | null>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyBackend = Backend<any>;

interface Held {
  backend: AnyBackend;
  handle: BackendTensor;
}

/** Storage of a tensor dropped without `dispose()` goes back when it is collected. */
const finalizer = new FinalizationRegistry<Held>(({ backend, handle }) => backend.release(handle));

/**
 * The engine's tensor: a backend handle plus autograd state. Backend-agnostic —
 * the same graph and grad rules run on the CPU reference and on WebGPU.
 * Reading values is the only async operation (`data`, `toArray`, `item`).
 */
export class DeviceTensor {
  grad: DeviceTensor | null = null;
  gradFn: GradNode | null = null;
  private disposed = false;

  constructor(
    readonly backend: AnyBackend,
    readonly handle: BackendTensor,
    public requiresGrad = false,
  ) {
    finalizer.register(this, { backend, handle }, this);
  }

  get shape(): Shape {
    return this.handle.shape;
  }
  get dtype(): string {
    return this.handle.dtype;
  }
  get ndim(): number {
    return this.handle.shape.length;
  }
  get size(): number {
    return productOf(this.handle.shape);
  }
  get isLeaf(): boolean {
    return this.gradFn === null;
  }

  /**
   * Reverse-mode backward from this tensor. With no `gradient` the tensor must
   * hold one element (a loss). Leaf tensors that require grad accumulate into
   * `.grad`. The graph is freed afterwards unless `retainGraph` is set.
   */
  backward(gradient?: DeviceTensor, options: { retainGraph?: boolean } = {}): void {
    runBackward(this, gradient, options.retainGraph ?? false);
  }

  /** Async readback of the values, row-major. */
  data(): Promise<HostArray> {
    this.assertLive();
    return this.backend.download(this.handle);
  }

  async toArray(): Promise<unknown> {
    const flat = Array.from(await this.data());
    if (this.ndim === 0) return flat[0];
    const build = (dim: number, offset: number): unknown[] => {
      const n = this.shape[dim]!;
      const step = productOf(this.shape.slice(dim + 1));
      return Array.from({ length: n }, (_, i) =>
        dim === this.ndim - 1 ? flat[offset + i] : build(dim + 1, offset + i * step),
      );
    };
    return build(0, 0);
  }

  async item(): Promise<number> {
    if (this.size !== 1) throw new Error(`item: tensor has ${this.size} elements, not 1`);
    return (await this.data())[0]!;
  }

  /** A graph-free tensor over the same values (shares storage). */
  detach(): DeviceTensor {
    this.assertLive();
    return new DeviceTensor(this.backend, this.backend.reshape(this.handle, this.shape), false);
  }

  setRequiresGrad(flag = true): this {
    if (flag && this.dtype !== "float32") throw new Error(`requires_grad: only float32 tensors can require grad (got ${this.dtype})`);
    this.requiresGrad = flag;
    return this;
  }

  /** Release storage now instead of at collection. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    finalizer.unregister(this);
    this.backend.release(this.handle);
    this.grad?.dispose();
    this.grad = null;
    this.gradFn = null;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("DeviceTensor: used after dispose()");
  }
}

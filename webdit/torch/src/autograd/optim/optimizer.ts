import type { BackendTensor } from "../../backend/backend";
import type { DeviceTensor } from "../device-tensor";

/**
 * Optimizer base: holds the trainable parameters (frozen ones are dropped) and
 * per-parameter state buffers on the parameter's own backend. `step()` runs one
 * in-place backend kernel per parameter — no readback.
 */
export abstract class Optimizer {
  readonly params: DeviceTensor[];
  protected readonly state = new Map<DeviceTensor, BackendTensor[]>();

  constructor(params: Iterable<DeviceTensor>) {
    this.params = [...params].filter((p) => p.requiresGrad);
    if (this.params.length === 0) throw new Error("optimizer got no parameters that require grad");
  }

  abstract step(): void;

  zeroGrad(): void {
    for (const p of this.params) {
      p.grad?.dispose();
      p.grad = null;
    }
  }

  /** Zero-filled state buffers for `p`, created on first use. */
  protected stateOf(p: DeviceTensor, count: number): BackendTensor[] {
    let s = this.state.get(p);
    if (!s) {
      s = Array.from({ length: count }, () => p.backend.full(p.shape, 0));
      this.state.set(p, s);
    }
    return s;
  }

  /** Release every state buffer. */
  dispose(): void {
    for (const [p, buffers] of this.state) for (const b of buffers) p.backend.release(b);
    this.state.clear();
  }
}

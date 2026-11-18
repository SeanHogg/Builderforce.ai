import type { BackendTensor } from "../../backend/backend";
import type { DeviceTensor } from "../device-tensor";

/** Per-parameter optimizer state: buffers on the parameter's backend, and its own step count. */
export interface ParamState {
  buffers: BackendTensor[];
  /** Updates applied to THIS parameter (a parameter without a gradient on a step is not advanced). */
  step: number;
}

/**
 * Optimizer base: holds the trainable parameters (frozen ones are dropped) and
 * per-parameter state. `step()` runs one in-place backend kernel per parameter
 * — no readback. Gradients are left intact (PyTorch semantics); `zeroGrad()`
 * clears them.
 */
export abstract class Optimizer {
  readonly params: DeviceTensor[];
  protected readonly state = new Map<DeviceTensor, ParamState>();

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

  /** `p`'s state, created on first use with `count` zero-filled buffers. */
  protected stateOf(p: DeviceTensor, count: number): ParamState {
    let s = this.state.get(p);
    if (!s) {
      s = { buffers: Array.from({ length: count }, () => p.backend.full(p.shape, 0)), step: 0 };
      this.state.set(p, s);
    }
    return s;
  }

  /** Release every state buffer. */
  dispose(): void {
    for (const [p, s] of this.state) for (const b of s.buffers) p.backend.release(b);
    this.state.clear();
  }
}

import type { DeviceTensor } from "../device-tensor";
import { Optimizer } from "./optimizer";

export interface SgdOptions {
  lr: number;
  momentum?: number;
  weightDecay?: number;
}

/** SGD with optional momentum and L2 weight decay (PyTorch semantics, no dampening/nesterov). */
export class SGD extends Optimizer {
  lr: number;
  readonly momentum: number;
  readonly weightDecay: number;

  constructor(params: Iterable<DeviceTensor>, options: SgdOptions) {
    super(params);
    this.lr = options.lr;
    this.momentum = options.momentum ?? 0;
    this.weightDecay = options.weightDecay ?? 0;
  }

  step(): void {
    for (const p of this.params) {
      if (!p.grad) continue;
      const buf = this.momentum > 0 ? this.stateOf(p, 1).buffers[0]! : null;
      p.backend.sgdStep(p.handle, p.grad.handle, buf, {
        lr: this.lr,
        momentum: this.momentum,
        weightDecay: this.weightDecay,
      });
    }
  }
}

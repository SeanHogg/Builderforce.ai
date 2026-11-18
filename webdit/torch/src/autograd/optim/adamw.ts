import type { DeviceTensor } from "../device-tensor";
import { Optimizer } from "./optimizer";

export interface AdamWOptions {
  lr?: number;
  betas?: [number, number];
  eps?: number;
  weightDecay?: number;
}

/**
 * AdamW (decoupled weight decay), PyTorch defaults. Runs the moved
 * `ADAMW_WGSL` kernel on WebGPU and its CPU mirror otherwise.
 *
 * Bias correction uses each parameter's OWN step count, advanced only when
 * that parameter has a gradient (PyTorch's `state['step']`). Gradients are left
 * intact. `gradScale` divides gradients accumulated over several backward passes.
 */
export class AdamW extends Optimizer {
  lr: number;
  readonly betas: [number, number];
  readonly eps: number;
  readonly weightDecay: number;

  constructor(params: Iterable<DeviceTensor>, options: AdamWOptions = {}) {
    super(params);
    this.lr = options.lr ?? 1e-3;
    this.betas = options.betas ?? [0.9, 0.999];
    this.eps = options.eps ?? 1e-8;
    this.weightDecay = options.weightDecay ?? 0.01;
  }

  step(gradScale = 1): void {
    for (const p of this.params) {
      if (!p.grad) continue;
      const s = this.stateOf(p, 2);
      s.step += 1;
      const [m, v] = s.buffers;
      p.backend.adamwStep(p.handle, p.grad.handle, m!, v!, {
        lr: this.lr,
        beta1: this.betas[0],
        beta2: this.betas[1],
        eps: this.eps,
        weightDecay: this.weightDecay,
        gradScale,
        step: s.step,
        keepGrad: true,
      });
    }
  }
}

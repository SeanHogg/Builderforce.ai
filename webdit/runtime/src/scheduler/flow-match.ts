import { assertSameLength } from "../tensor-ops";
import type { MutableTensor } from "../types";
import type { Scheduler } from "./index";

/**
 * Rectified-flow Euler sampler. LTX-2 was trained with rectified flow
 * matching: the integration step is `x_t -= (sigma_t - sigma_{t+1}) * v`,
 * where v is the model-predicted velocity.
 */
export class FlowMatchScheduler implements Scheduler {
  private readonly sigmas: Float32Array;

  constructor(steps: number) {
    this.sigmas = new Float32Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      this.sigmas[i] = 1 - i / steps;
    }
  }

  timestepAt(stepIdx: number): number {
    return this.sigmas[stepIdx]!;
  }

  step(latent: MutableTensor, prediction: MutableTensor, stepIdx: number): void {
    assertSameLength(latent, prediction, "FlowMatchScheduler.step");
    const dt = this.sigmas[stepIdx]! - this.sigmas[stepIdx + 1]!;
    const x = latent.data;
    const v = prediction.data;
    for (let i = 0; i < x.length; i++) x[i] = x[i]! - dt * v[i]!;
  }
}

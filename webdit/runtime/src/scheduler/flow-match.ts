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

  step(_latent: unknown, _prediction: unknown, _stepIdx: number): void {
    throw new Error("FlowMatchScheduler.step not yet implemented");
  }
}

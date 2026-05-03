import { assertSameLength } from "../tensor-ops";
import type { MutableTensor } from "../types";
import type { Scheduler } from "./index";

/**
 * Karras EDM-style Euler sampler. Use for models trained with epsilon-
 * prediction and a noise schedule (Stable Diffusion / CogVideoX family).
 *
 * `prediction` is interpreted as the predicted noise eps at the current
 * sigma. The integration is:
 *   d_x/d_sigma = (x - denoised) / sigma  =  eps  (when prediction == eps)
 *   x_{t+1} = x_t + (sigma_{t+1} - sigma_t) * d_x/d_sigma
 *
 * For models that emit velocity / x0 / flow output, use a different
 * scheduler — the math here is parameterization-specific.
 */
export class EulerScheduler implements Scheduler {
  readonly sigmas: Float32Array;

  constructor(
    steps: number,
    sigmaMin = 0.002,
    sigmaMax = 14.61,
    rho = 7.0,
  ) {
    if (steps < 1) throw new Error(`EulerScheduler: steps must be >= 1, got ${steps}`);
    this.sigmas = new Float32Array(steps + 1);
    const a = Math.pow(sigmaMax, 1 / rho);
    const b = Math.pow(sigmaMin, 1 / rho);
    for (let i = 0; i < steps; i++) {
      const t = i / Math.max(1, steps - 1);
      this.sigmas[i] = Math.pow(a + t * (b - a), rho);
    }
    this.sigmas[steps] = 0;
  }

  timestepAt(stepIdx: number): number {
    return this.sigmas[stepIdx]!;
  }

  step(latent: MutableTensor, prediction: MutableTensor, stepIdx: number): void {
    assertSameLength(latent, prediction, "EulerScheduler.step");
    const sigma = this.sigmas[stepIdx]!;
    const sigmaNext = this.sigmas[stepIdx + 1]!;
    if (sigma === 0) return;
    const k = (sigmaNext - sigma) / sigma;
    const x = latent.data;
    const eps = prediction.data;
    for (let i = 0; i < x.length; i++) x[i] = x[i]! + k * eps[i]!;
  }
}

import { assertSameLength } from "../tensor-ops";
import type { MutableTensor } from "../types";
import type { Scheduler } from "./index";

const NUM_TRAIN_TIMESTEPS = 1000;

export interface DdimVPredZsnrOptions {
  numTrainTimesteps?: number;
  betaStart?: number;
  betaEnd?: number;
  /** SNR-shift factor CogVideoX applies for its longer video sequence. */
  snrShiftScale?: number;
}

/**
 * CogVideoX's exact sampling math — a faithful port of diffusers'
 * `CogVideoXDDIMScheduler` (v-prediction, discrete integer timesteps with
 * "trailing" spacing, zero-terminal-SNR rescaled betas, and an SNR-shift
 * factor of 3.0).
 *
 * webdit's other two schedulers (`EulerScheduler`, `FlowMatchScheduler`)
 * assume a continuous sigma "timestep" and an epsilon/flow-velocity model
 * output — CogVideoX was trained with neither (discrete 0..999 timesteps,
 * v-prediction, a rescaled noise schedule). Running it through either of
 * those would silently produce incoherent output: same shapes, same op
 * graph, wrong math. This scheduler exists so `cogvideox-2b`'s manifest can
 * declare the parameterization it actually needs.
 *
 * Only exact-divisor step counts (steps where `1000 % steps === 0` — 50, 25,
 * 20, 10, 100, …) are guaranteed to match diffusers bit-for-bit: `step()`
 * derives `t_prev` from the precomputed timestep list's NEXT entry, which
 * only equals diffusers' `timestep - num_train_timesteps // steps` when the
 * division is exact. CogVideoX-2b's own default is 50 steps.
 */
export class DdimVPredZsnrScheduler implements Scheduler {
  private readonly alphasCumprod: Float64Array;
  private readonly finalAlphaCumprod = 1.0; // set_alpha_to_one=true
  readonly timesteps: readonly number[];

  constructor(steps: number, opts: DdimVPredZsnrOptions = {}) {
    if (steps < 1) throw new Error(`DdimVPredZsnrScheduler: steps must be >= 1, got ${steps}`);
    const T = opts.numTrainTimesteps ?? NUM_TRAIN_TIMESTEPS;
    const betaStart = opts.betaStart ?? 0.00085;
    const betaEnd = opts.betaEnd ?? 0.012;
    const snrShiftScale = opts.snrShiftScale ?? 3.0;

    const alphasCumprod = computeAlphasCumprod(T, betaStart, betaEnd);
    rescaleZeroTerminalSnrInPlace(alphasCumprod);
    if (snrShiftScale !== 1) {
      for (let i = 0; i < T; i++) {
        const a = alphasCumprod[i]!;
        alphasCumprod[i] = a / (snrShiftScale + (1 - snrShiftScale) * a);
      }
    }
    this.alphasCumprod = alphasCumprod;

    // "trailing" timestep spacing (diffusers `timestep_spacing="trailing"`):
    // np.arange(T, 0, -stepRatio).round() - 1
    const stepRatio = T / steps;
    const raw: number[] = [];
    for (let x = T; x > 0; x -= stepRatio) raw.push(Math.round(x) - 1);
    this.timesteps = raw.slice(0, steps).map((t) => Math.min(T - 1, Math.max(0, t)));
    if (this.timesteps.length !== steps) {
      throw new Error(
        `DdimVPredZsnrScheduler: expected ${steps} timesteps, computed ${this.timesteps.length}`,
      );
    }
  }

  timestepAt(stepIdx: number): number {
    return this.timesteps[stepIdx]!;
  }

  /** v-prediction DDIM step (eta=0, deterministic), `clip_sample=false`. */
  step(latent: MutableTensor, prediction: MutableTensor, stepIdx: number): void {
    assertSameLength(latent, prediction, "DdimVPredZsnrScheduler.step");
    const t = this.timesteps[stepIdx]!;
    const tPrevIdx = stepIdx + 1;
    const tPrev = tPrevIdx < this.timesteps.length ? this.timesteps[tPrevIdx]! : -1;

    const alphaProdT = this.alphasCumprod[t]!;
    const alphaProdTPrev = tPrev >= 0 ? this.alphasCumprod[tPrev]! : this.finalAlphaCumprod;
    const betaProdT = 1 - alphaProdT;

    const sqrtAlphaT = Math.sqrt(alphaProdT);
    const sqrtBetaT = Math.sqrt(betaProdT);
    const sqrtAlphaTPrev = Math.sqrt(alphaProdTPrev);
    const sqrtBetaTPrev = Math.sqrt(1 - alphaProdTPrev);

    const x = latent.data;
    const v = prediction.data;
    for (let i = 0; i < x.length; i++) {
      const sample = x[i]!;
      const velocity = v[i]!;
      // v-prediction -> (x0, eps)
      const predOriginalSample = sqrtAlphaT * sample - sqrtBetaT * velocity;
      const predEpsilon = sqrtAlphaT * velocity + sqrtBetaT * sample;
      const predSampleDirection = sqrtBetaTPrev * predEpsilon;
      x[i] = sqrtAlphaTPrev * predOriginalSample + predSampleDirection;
    }
  }
}

function computeAlphasCumprod(T: number, betaStart: number, betaEnd: number): Float64Array {
  // "scaled_linear" beta schedule: betas = linspace(sqrt(start), sqrt(end), T) ** 2
  const bStartSqrt = Math.sqrt(betaStart);
  const bEndSqrt = Math.sqrt(betaEnd);
  const alphasCumprod = new Float64Array(T);
  let acc = 1;
  for (let i = 0; i < T; i++) {
    const bSqrt = bStartSqrt + ((bEndSqrt - bStartSqrt) * i) / (T - 1);
    const beta = bSqrt * bSqrt;
    acc *= 1 - beta;
    alphasCumprod[i] = acc;
  }
  return alphasCumprod;
}

/** Rescales `alphasCumprod` in place so the terminal SNR reaches exactly
 *  zero (Lin et al., "Common Diffusion Noise Schedules and Sample Steps are
 *  Flawed") — `rescale_betas_zero_snr=true` in CogVideoX's scheduler config. */
function rescaleZeroTerminalSnrInPlace(alphasCumprod: Float64Array): void {
  const n = alphasCumprod.length;
  const sqrtAlphasCumprod = new Float64Array(n);
  for (let i = 0; i < n; i++) sqrtAlphasCumprod[i] = Math.sqrt(alphasCumprod[i]!);

  const sqrt0 = sqrtAlphasCumprod[0]!;
  const sqrtT = sqrtAlphasCumprod[n - 1]!;
  const denom = sqrt0 - sqrtT;

  for (let i = 0; i < n; i++) {
    let v = sqrtAlphasCumprod[i]! - sqrtT;
    v *= sqrt0 / denom;
    alphasCumprod[i] = v * v;
  }
}

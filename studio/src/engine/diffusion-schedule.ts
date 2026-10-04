/**
 * Diffusion schedule math — the DDPM noise schedule, the deterministic noise
 * source, the LCM consistency step and the LCM guidance-scale embedding.
 *
 * Pure functions over Float32Arrays: no ORT, no sessions, no I/O. The frame
 * engine (`diffusion-engine.ts`) composes them around its UNet/VAE calls, and
 * the tests exercise them directly instead of through a mocked runtime.
 */

import type { LcmModelDescriptor } from '../types';

// ---------------------------------------------------------------------------
// DDPM noise schedule — precomputed alpha_cumprod for the standard SD beta
// schedule (scaled_linear, beta_start=0.00085, beta_end=0.012, T=1000).
// Shared by every lcm-diffusion model: all fine-tuned on the same base schedule.
// ---------------------------------------------------------------------------

const TRAIN_TIMESTEPS = 1000;

const ALPHAS_CUMPROD = computeAlphasCumprod(0.00085, 0.012, TRAIN_TIMESTEPS);

function computeAlphasCumprod(betaStart: number, betaEnd: number, T: number): Float32Array {
  const out = new Float32Array(T);
  const sqrtStart = Math.sqrt(betaStart);
  const sqrtEnd = Math.sqrt(betaEnd);
  let running = 1.0;
  for (let t = 0; t < T; t++) {
    const sqrtBeta = sqrtStart + (sqrtEnd - sqrtStart) * (t / (T - 1));
    const beta = sqrtBeta * sqrtBeta;
    running *= 1 - beta;
    out[t] = running;
  }
  return out;
}

/**
 * ᾱ_t for an integer timestep. Out-of-range timesteps (negative, ≥ T, NaN)
 * clamp to the schedule's ends instead of silently reading `undefined` and
 * falling back to a magic constant — a timestep of 1000 now means "as noisy as
 * the schedule goes", not "ᾱ = 0.001".
 */
export function alphaCumprodAt(timestep: number): number {
  const t = Number.isFinite(timestep) ? Math.round(timestep) : TRAIN_TIMESTEPS - 1;
  return ALPHAS_CUMPROD[Math.min(TRAIN_TIMESTEPS - 1, Math.max(0, t))]!;
}

/** The noise fraction `sqrt(1 − ᾱ_t)` at a timestep — the coefficient on the
 *  noise term of forward diffusion. */
export function noiseScaleAt(timestep: number): number {
  return Math.sqrt(1 - alphaCumprodAt(timestep));
}

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

/**
 * Float32 gaussian noise via Box-Muller over a seeded LCG. Single deterministic
 * source for the initial latent, the LCM re-noise step and img2img forward
 * noising, so one seed reproduces one video exactly.
 */
export function gaussianNoise(length: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const u1 = (state + 1) / 0x100000000;
    state = (state * 1664525 + 1013904223) >>> 0;
    const u2 = (state + 1) / 0x100000000;
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return out;
}

/**
 * DDPM forward diffusion: `sqrt(ᾱ_t)·clean + sqrt(1−ᾱ_t)·noise`. Used by the
 * video engine's img2img recursion to re-noise the previous frame's clean
 * latent part-way up the schedule.
 */
export function forwardDiffuse(clean: Float32Array, timestep: number, seed: number): Float32Array {
  const alpha = alphaCumprodAt(timestep);
  const sqrtAlpha = Math.sqrt(alpha);
  const sqrtOneMinusAlpha = Math.sqrt(1 - alpha);
  const noise = gaussianNoise(clean.length, seed);
  const out = new Float32Array(clean.length);
  for (let i = 0; i < clean.length; i++) out[i] = sqrtAlpha * clean[i]! + sqrtOneMinusAlpha * noise[i]!;
  return out;
}

// ---------------------------------------------------------------------------
// LCM consistency step
// ---------------------------------------------------------------------------

/** Seed offset between successive re-noise draws within one denoise run. */
const RENOISE_SEED_STRIDE = 7919;

/**
 * One LCMScheduler step, IN PLACE on `sample`.
 *
 *   x0 = (x_t − sqrt(1−ᾱ_t)·ε̂) / sqrt(ᾱ_t)                (predicted clean latent)
 *   x_{t'} = sqrt(ᾱ_t')·x0 + sqrt(1−ᾱ_t')·z                (re-noise to the next step)
 *
 * On the last step (`nextTimestep === null`) the sample becomes x0. Writing in
 * place means the denoise loop allocates no per-step latent buffers — at 768²
 * that is 36k floats × 2 per step saved, and on a 4-step × 24-frame video the
 * garbage collector stops pausing the loop between UNet calls.
 */
export function lcmStep(
  sample: Float32Array,
  noisePred: Float32Array,
  timestep: number,
  nextTimestep: number | null,
  seed: number,
  stepIndex: number,
): void {
  const alpha = alphaCumprodAt(timestep);
  const sqrtAlpha = Math.sqrt(alpha);
  const sqrtOneMinusAlpha = Math.sqrt(1 - alpha);

  if (nextTimestep === null) {
    for (let j = 0; j < sample.length; j++) {
      sample[j] = (sample[j]! - sqrtOneMinusAlpha * noisePred[j]!) / sqrtAlpha;
    }
    return;
  }

  const alphaNext = alphaCumprodAt(nextTimestep);
  const sqrtAlphaNext = Math.sqrt(alphaNext);
  const sqrtOneMinusAlphaNext = Math.sqrt(1 - alphaNext);
  const noise = gaussianNoise(sample.length, seed + stepIndex * RENOISE_SEED_STRIDE);
  for (let j = 0; j < sample.length; j++) {
    const x0 = (sample[j]! - sqrtOneMinusAlpha * noisePred[j]!) / sqrtAlpha;
    sample[j] = sqrtAlphaNext * x0 + sqrtOneMinusAlphaNext * noise[j]!;
  }
}

/**
 * Classifier-free guidance mix, IN PLACE on `cond`:
 * `ε̂ = ε_uncond + w·(ε_cond − ε_uncond)`.
 */
export function applyGuidance(cond: Float32Array, uncond: Float32Array, guidance: number): void {
  for (let i = 0; i < cond.length; i++) {
    cond[i] = uncond[i]! + guidance * (cond[i]! - uncond[i]!);
  }
}

// ---------------------------------------------------------------------------
// LCM guidance-scale embedding (`timestep_cond`)
// ---------------------------------------------------------------------------

/**
 * Default LCM distillation guidance scale embedded into `timestep_cond` when a
 * model descriptor doesn't override it. Matches diffusers
 * `LatentConsistencyModelPipeline`'s default `guidance_scale = 8.5` (the embedded
 * `w` is `guidance_scale - 1`). This is the scale the UNet was DISTILLED with —
 * unrelated to the runtime cond/uncond mix scale (`defaultGuidance`, ~1 for LCM).
 */
export const DEFAULT_LCM_GUIDANCE_SCALE = 8.5;

/**
 * Build the `timestep_cond` guidance-scale embedding feed for an LCM model.
 * Embeds `(descriptor.lcmGuidanceScale ?? DEFAULT_LCM_GUIDANCE_SCALE) - 1` — the
 * DISTILLATION scale — into a `lcmGuidanceEmbedDim`-wide sinusoidal vector.
 *
 * Embedding the runtime guidance instead (`runtimeGuidance - 1`, which is 0 for
 * LCM's CFG≈1) yields a degenerate all-[0…,1…] vector that under-conditions the
 * UNet — the root cause of the washed / distorted two-pass refinement output.
 */
export function lcmGuidanceCondEmbedding(descriptor: LcmModelDescriptor): Float32Array {
  const dim = descriptor.lcmGuidanceEmbedDim ?? 256;
  const w = (descriptor.lcmGuidanceScale ?? DEFAULT_LCM_GUIDANCE_SCALE) - 1;
  return guidanceScaleEmbedding(w, dim);
}

/** Sinusoidal guidance-scale embedding (diffusers parity). */
function guidanceScaleEmbedding(w: number, dim: number): Float32Array {
  const half = Math.floor(dim / 2);
  const out = new Float32Array(dim);
  const logBase = Math.log(10000) / Math.max(1, half - 1);
  const wScaled = w * 1000;
  for (let i = 0; i < half; i++) {
    const freq = Math.exp(-logBase * i);
    out[i] = Math.sin(wScaled * freq);
    if (half + i < dim) out[half + i] = Math.cos(wScaled * freq);
  }
  return out;
}

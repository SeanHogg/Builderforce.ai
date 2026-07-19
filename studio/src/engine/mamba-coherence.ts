/**
 * MambaCoherence — bridge the SSM state vector into the diffusion pipeline.
 *
 * Two coherence modes, one shared projection:
 *
 *   - 'prompt-bias':      append a state-derived token to the prompt embedding.
 *                          Cheap, drop-in, works with any U-Net.
 *   - 'latent-residual':  inject a state-derived bias into the initial latent
 *                          noise. Stronger temporal lock.
 *
 * Both modes call `projectState()` to convert the raw Float32 state vector
 * into a tensor of the target shape. The mode-specific logic is *only* where
 * the projection result is applied. No duplicated state→tensor pipelines.
 *
 * State advancement uses the builderforce-memory-engine peerDep — we never
 * reimplement the SSM scan kernel here.
 */

import type { CoherenceMode, MambaStateSnapshot } from '../types';
import { slerp } from './frame-interpolator';

export interface CoherenceContext {
  mode: CoherenceMode;
  strength: number;
  state: MambaStateSnapshot;
}

export interface ApplyToPromptArgs {
  ctx: CoherenceContext;
  /** Original prompt embedding [1, seqLen, embedDim]. */
  promptEmbedding: Float32Array;
  /** Sequence length (e.g. 77 for CLIP). */
  seqLen: number;
  /** Embedding dimension (768 for SD1.x, 1024 for SD2.x / SD-Turbo). Read from MODEL_REGISTRY, not hardcoded. */
  embedDim: number;
}

export interface ApplyToLatentArgs {
  ctx: CoherenceContext;
  /** Initial latent [1, 4, h/8, w/8]. */
  latent: Float32Array;
  /**
   * Fraction of the latent that is fresh noise, in [0, 1]. The bias is a
   * per-channel constant offset designed for unit-variance Gaussian noise, so
   * scaling it by the noise fraction keeps it from disfiguring the signal
   * portion of a partially-denoised (img2img) latent.
   *   1 (default) → pure noise latent (frame 0 / anchor-walk): full bias.
   *   sqrt(1-ᾱ_t) → img2img latent re-noised to timestep t: perturb only its
   *                  noise component, leave the carried-forward signal intact.
   * See `latentResidualBiasScale` for how the engine derives this.
   */
  noiseScale?: number;
}

/**
 * Project a state snapshot into a vector of `targetDim` floats. This is the
 * single shared kernel both modes call — adding a third mode later means
 * "decide how to apply the projection result", not "write a new projection".
 */
export function projectState(state: MambaStateSnapshot, targetDim: number): Float32Array {
  const out = new Float32Array(targetDim);
  if (state.data.length === 0) return out;

  // Deterministic linear projection: hash state index into a target index,
  // accumulate weighted sums. Lightweight, no training, stable across frames.
  for (let i = 0; i < state.data.length; i++) {
    const v = state.data[i];
    const targetIdx = mixIndex(i, state.dim, state.channels, state.order, targetDim);
    out[targetIdx] += v;
  }

  // L2-normalise so strength is comparable across state sizes.
  let norm = 0;
  for (let i = 0; i < targetDim; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < targetDim; i++) out[i] /= norm;
  return out;
}

/**
 * Prompt-bias mode: replace the last token slot in the prompt embedding with
 * the projected state. Strength controls the blend with the original token.
 */
export function applyToPrompt(args: ApplyToPromptArgs): Float32Array {
  const { ctx, promptEmbedding, seqLen, embedDim } = args;
  if (ctx.strength <= 0) return promptEmbedding;

  const stateVec = projectState(ctx.state, embedDim);
  const out = new Float32Array(promptEmbedding);

  const tokenOffset = (seqLen - 1) * embedDim;
  for (let d = 0; d < embedDim; d++) {
    const original = out[tokenOffset + d];
    out[tokenOffset + d] = original * (1 - ctx.strength) + stateVec[d] * ctx.strength;
  }
  return out;
}

/**
 * Variance-preserving blend of two unit-Gaussian noise samples.
 *
 *   out = sqrt(1 - alpha) * anchor + sqrt(alpha) * frame
 *
 * Used by `VideoEngine.generate` to walk one anchor latent across frames
 * instead of sampling i.i.d. noise per frame — which is the standard
 * Deforum / Stable-WarpFusion technique for video continuity. The diffusion
 * process is dominated by initial noise; without an anchor, each frame is
 * a totally fresh interpretation of the prompt (different composition,
 * different colors) even when the prompt is identical.
 *
 *   alpha = 0   → exactly anchor (no motion at all)
 *   alpha = 0.15 → "slight motion" — colors and composition stable across frames
 *   alpha = 1   → exactly frame (back to i.i.d. — the broken baseline)
 *
 * The sqrt(1-α) / sqrt(α) coefficients keep the result unit-variance, which
 * the diffusion scheduler expects from its initial noise.
 */
export function blendNoise(anchor: Float32Array, frame: Float32Array, alpha: number): Float32Array {
  if (anchor.length !== frame.length) {
    throw new Error(`blendNoise: length mismatch (${anchor.length} vs ${frame.length})`);
  }
  if (alpha <= 0) return new Float32Array(anchor);
  if (alpha >= 1) return new Float32Array(frame);
  const a = Math.sqrt(1 - alpha);
  const b = Math.sqrt(alpha);
  const out = new Float32Array(anchor.length);
  for (let i = 0; i < anchor.length; i++) {
    out[i] = a * anchor[i] + b * frame[i];
  }
  return out;
}

/**
 * Per-frame initial latent for the anchor-walk path, sampled along a SMOOTH
 * trajectory so consecutive frames are adjacent (incremental motion) instead of
 * jittering randomly around the anchor.
 *
 * The bug this fixes: the original path drew i.i.d. noise per frame
 * (`sampleInitialLatent(seed + frameIdx)`) and blended each independently with
 * the anchor. Every frame then sat the same `motionAmount` distance from the
 * anchor but in a RANDOM direction, so frame k and k+1 were no closer than frame
 * k and k+10 — the sequence read as flicker, not motion (the "render more frames
 * that are incremental" feedback).
 *
 * Here the drift follows a single great-circle arc between two fixed endpoint
 * noises (`walkStart` → `walkEnd`): frame at `t = frameIdx / (frameCount - 1)`
 * slerps along that arc, so the per-frame noise advances monotonically and
 * neighbouring frames differ by ≈ arc/frameCount. slerp preserves unit norm, so
 * `blendNoise`'s variance contract still holds. Raising the frame count makes
 * the steps finer (smoother) rather than denser-but-still-random.
 *
 * `motionAmount = 0` collapses to the pure anchor (no motion); higher values let
 * the walk pull the composition further from the anchor each step.
 */
export function anchorWalkLatent(
  anchor: Float32Array,
  walkStart: Float32Array,
  walkEnd: Float32Array,
  frameIdx: number,
  frameCount: number,
  motionAmount: number,
): Float32Array {
  const t = frameCount > 1 ? frameIdx / (frameCount - 1) : 0;
  const frameNoise = slerp(walkStart, walkEnd, t);
  return blendNoise(anchor, frameNoise, motionAmount);
}

/**
 * Whether keyframe `keyframeIndex` should restart from a FRESH anchor latent
 * instead of carrying the previous frame's latent forward via img2img recursion.
 *
 * img2img recursion re-noises frame N's clean latent to seed frame N+1, which
 * carries scene content forward — but each VAE-encode→denoise round-trip adds a
 * small error, so on long clips (~30+ frames) detail accumulates blur and the
 * scene degrades. Periodically dropping back to a fresh full-noise anchor (a
 * full denoise pass, not a partial img2img one) bounds that accumulation to at
 * most `interval` keyframes' worth of drift.
 *
 *   interval <= 0 / non-finite → never refresh (carry forward indefinitely —
 *                                the prior unbounded behaviour, still the default)
 *   interval = K               → refresh on keyframes K, 2K, 3K, … (never on
 *                                keyframe 0, which already starts fresh)
 *
 * Pure + unit-tested so the long-clip drift bound has one source of truth.
 */
export function isAnchorRefreshFrame(keyframeIndex: number, interval: number): boolean {
  if (!Number.isFinite(interval) || interval <= 0) return false;
  const k = Math.floor(interval);
  return keyframeIndex > 0 && keyframeIndex % k === 0;
}

/**
 * 2D spatial shift on an NCHW latent with edge-replicate (clamp) padding.
 * Used by `VideoEngine.generate` to add directional camera motion to
 * img2img-recursion frames: shifting the prior latent down/right before
 * re-noising simulates the camera panning up/left (the world flows in the
 * opposite direction). One latent pixel = 8 output pixels (VAE down-factor
 * of 8), so dx=1 in latent space is an 8-pixel pan in the rendered frame.
 *
 * Out-of-bounds source coordinates clamp to the nearest in-bounds pixel
 * (replicate / edge padding) rather than zero-filling. Zero-fill produced
 * a black band on every shifted frame that the (typically truncated)
 * img2img denoise couldn't clean up — `shiftLatentClampsToEdge` test in
 * mamba-coherence.test.ts locks this so a future "optimization" back to
 * zero-fill is caught instead of shipping as edge artifacts.
 *
 * Layout assumption: NCHW packed as [c, y, x] with one batch (the diffusion
 * engine's shape contract — see `latentShape: [1, 4, h, w]` in
 * `DiffusionEngine.denoise`).
 */
export function shiftLatent(
  latent: Float32Array,
  shape: { channels: number; height: number; width: number },
  dx: number,
  dy: number,
): Float32Array {
  const { channels, height, width } = shape;
  if (latent.length !== channels * height * width) {
    throw new Error(
      `shiftLatent: length ${latent.length} doesn't match shape ${channels}x${height}x${width}=${channels * height * width}`,
    );
  }
  if (dx === 0 && dy === 0) return new Float32Array(latent);
  const out = new Float32Array(latent.length);
  const idx = (c: number, y: number, x: number) =>
    c * (height * width) + y * width + x;
  const clamp = (v: number, lo: number, hi: number) =>
    v < lo ? lo : v > hi ? hi : v;
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < height; y++) {
      const srcY = clamp(y - dy, 0, height - 1);
      for (let x = 0; x < width; x++) {
        const srcX = clamp(x - dx, 0, width - 1);
        out[idx(c, y, x)] = latent[idx(c, srcY, srcX)];
      }
    }
  }
  return out;
}

/**
 * Center-anchored zoom of an NCHW latent with edge-replicate padding + bilinear
 * sampling. Used by `VideoEngine` for dolly camera moves: `scale > 1` magnifies
 * the central region (camera pushing IN), `scale < 1` shrinks it (pulling OUT).
 *
 * For each destination pixel we sample the source at
 *   src = center + (dst - center) / scale
 * so scale>1 reads a smaller window (zoom in) and scale<1 a larger one. Out-of-
 * bounds reads clamp to the edge (replicate) — the same choice as `shiftLatent`,
 * for the same reason: zero-fill leaves a black border the truncated img2img
 * denoise can't clean up. Bilinear (not nearest) avoids the blocky aliasing a
 * pure-integer resample would compound frame-to-frame. Locked by the
 * scaleLatentZoomsAboutCenter / scaleLatentClampsToEdge tests.
 *
 * Layout: NCHW packed as [c, y, x], one batch — the diffusion engine's contract.
 */
export function scaleLatent(
  latent: Float32Array,
  shape: { channels: number; height: number; width: number },
  scale: number,
): Float32Array {
  const { channels, height, width } = shape;
  if (latent.length !== channels * height * width) {
    throw new Error(
      `scaleLatent: length ${latent.length} doesn't match shape ${channels}x${height}x${width}=${channels * height * width}`,
    );
  }
  if (scale === 1 || !Number.isFinite(scale) || scale <= 0) return new Float32Array(latent);
  const out = new Float32Array(latent.length);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const idx = (c: number, y: number, x: number) => c * (height * width) + y * width + x;
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < height; y++) {
      const srcYf = cy + (y - cy) / scale;
      const y0 = clamp(Math.floor(srcYf), 0, height - 1);
      const y1 = clamp(y0 + 1, 0, height - 1);
      const wy = srcYf - Math.floor(srcYf);
      for (let x = 0; x < width; x++) {
        const srcXf = cx + (x - cx) / scale;
        const x0 = clamp(Math.floor(srcXf), 0, width - 1);
        const x1 = clamp(x0 + 1, 0, width - 1);
        const wx = srcXf - Math.floor(srcXf);
        const top = latent[idx(c, y0, x0)] * (1 - wx) + latent[idx(c, y0, x1)] * wx;
        const bot = latent[idx(c, y1, x0)] * (1 - wx) + latent[idx(c, y1, x1)] * wx;
        out[idx(c, y, x)] = top * (1 - wy) + bot * wy;
      }
    }
  }
  return out;
}

/**
 * Noise-level scale for the latent-residual Mamba bias — the single source of
 * truth for "how much (if any) latent-side bias to apply this frame". Returns
 * the multiplier `applyToLatent` should use for its per-channel offset; `0`
 * means skip the bias entirely.
 *
 * The bias is a per-channel broadcast constant designed for unit-variance
 * Gaussian noise. On a partially-denoised img2img latent
 *   x_t = sqrt(ᾱ_t)·clean + sqrt(1-ᾱ_t)·noise
 * applying it at full strength shifts the *signal* (clean) component out of the
 * UNet's trained range, which disfigures the frame and compounds frame-to-frame
 * as Mamba state accumulates (the original bug — see git history of the previous
 * binary skip-gate). Scaling the bias by `sqrt(1-ᾱ_t)` (the noise fraction)
 * perturbs only the noise component, so latent-residual coherence and img2img
 * recursion can finally compose instead of one being forced off.
 *
 *   mode != latent-residual         → 0   (mode is a no-op on the latent path)
 *   latent-residual + fresh noise   → 1   (frame 0 / anchor-walk: pure noise)
 *   latent-residual + img2img       → img2imgNoiseScale = sqrt(1-ᾱ_t)
 *
 * Locked by a unit test so a future refactor can't silently regress to either
 * the catastrophic full-strength-under-img2img bug or the conservative
 * skip-everything stopgap.
 */
export function latentResidualBiasScale(
  mode: CoherenceMode,
  useImg2Img: boolean,
  img2imgNoiseScale: number,
): number {
  if (mode !== 'latent-residual') return 0;
  if (!useImg2Img) return 1;
  if (!Number.isFinite(img2imgNoiseScale) || img2imgNoiseScale <= 0) return 0;
  return Math.min(1, img2imgNoiseScale);
}

/**
 * Latent-residual mode: add the projected state (broadcast across spatial
 * positions) to the initial noise latent. Strength scales the additive bias;
 * `noiseScale` (default 1) further scales it by the latent's noise fraction so
 * the bias composes safely with img2img recursion — see `latentResidualBiasScale`.
 */
export function applyToLatent(args: ApplyToLatentArgs): Float32Array {
  const { ctx, latent } = args;
  const noiseScale = args.noiseScale ?? 1;
  if (ctx.strength <= 0 || noiseScale <= 0) return latent;

  const channels = 4;
  const spatial = latent.length / channels;
  const stateVec = projectState(ctx.state, channels);
  const out = new Float32Array(latent);

  for (let c = 0; c < channels; c++) {
    const bias = stateVec[c] * ctx.strength * noiseScale;
    const base = c * spatial;
    for (let i = 0; i < spatial; i++) {
      out[base + i] += bias;
    }
  }
  return out;
}

/**
 * Advance the SSM state by one frame's worth of "input" — currently a single
 * pooled summary of the just-generated frame's latent. The host can swap the
 * input strategy without touching the projection logic above.
 *
 * NOTE: this initial implementation runs the recurrence on the CPU as a
 * Float32 loop for clarity. The builderforce-memory-engine peerDep will replace
 * this body with the WGSL selective-scan kernel once the scan call shape stabilises
 * (tracked in the Consolidated Gap Register).
 */
export function advanceState(
  state: MambaStateSnapshot,
  input: Float32Array
): MambaStateSnapshot {
  const next = new Float32Array(state.data.length);
  const decay = 0.92;

  // Pool the input down to `channels` values via averaging.
  const pooled = new Float32Array(state.channels);
  const stride = Math.max(1, Math.floor(input.length / state.channels));
  for (let c = 0; c < state.channels; c++) {
    let sum = 0;
    let count = 0;
    for (let i = c * stride; i < (c + 1) * stride && i < input.length; i++) {
      sum += input[i];
      count++;
    }
    pooled[c] = count > 0 ? sum / count : 0;
  }

  // h_{t+1} = decay * h_t + B * pooled_input
  for (let c = 0; c < state.channels; c++) {
    for (let k = 0; k < state.order; k++) {
      const idx = c * state.order + k;
      next[idx] = decay * (state.data[idx] ?? 0) + 0.1 * pooled[c];
    }
  }

  return {
    data: Array.from(next),
    dim: state.dim,
    order: state.order,
    channels: state.channels,
    step: state.step + 1,
  };
}

/** Zero-state initialiser for a fresh agent / fresh video generation run. */
export function emptyState(opts: { dim: number; order: number; channels: number }): MambaStateSnapshot {
  return {
    data: new Array(opts.channels * opts.order).fill(0),
    dim: opts.dim,
    order: opts.order,
    channels: opts.channels,
    step: 0,
  };
}

function mixIndex(i: number, dim: number, channels: number, order: number, targetDim: number): number {
  // Simple integer hash that distributes input indices across targetDim.
  const seed = (i * 2654435761) ^ (dim * 374761393) ^ (channels * 1597334677) ^ (order * 668265263);
  return Math.abs(seed) % targetDim;
}

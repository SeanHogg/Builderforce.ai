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
 * State advancement uses the mambacode.js peerDep — we never reimplement the
 * SSM scan kernel here.
 */

import type { CoherenceMode, MambaStateSnapshot } from '../types';

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
 * Latent-residual mode: add the projected state (broadcast across spatial
 * positions) to the initial noise latent. Strength scales the additive bias.
 */
export function applyToLatent(args: ApplyToLatentArgs): Float32Array {
  const { ctx, latent } = args;
  if (ctx.strength <= 0) return latent;

  const channels = 4;
  const spatial = latent.length / channels;
  const stateVec = projectState(ctx.state, channels);
  const out = new Float32Array(latent);

  for (let c = 0; c < channels; c++) {
    const bias = stateVec[c] * ctx.strength;
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
 * Float32 loop for clarity. The mambacode.js peerDep will replace this body
 * with the WGSL selective-scan kernel once the scan call shape stabilises
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

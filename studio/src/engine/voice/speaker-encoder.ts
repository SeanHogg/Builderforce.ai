/**
 * speaker-encoder (Phase 1) — reference audio ▶ a fixed-dim speaker identity
 * vector.
 *
 * This is the cheap, reusable half of the foundation: the conditioning signal
 * every later stage (the SSM acoustic model) reads to clone a voice. It is an
 * x-vector-style encoder — statistics pooling (mean + standard deviation of the
 * log-mel features across time) is exactly the pooling layer that turns a
 * variable-length utterance into a single utterance-level identity vector in the
 * x-vector / ECAPA-TDNN family. Mean captures the average spectral envelope
 * (formant/timbre fingerprint); std captures how that envelope moves (prosodic
 * texture). The pooled statistics are projected to `embeddingDim` and
 * L2-normalised so identity compares by cosine.
 *
 * Weight-free and deterministic, consistent with the rest of the studio engine
 * (see mamba-coherence's `projectState`): the projection is a fixed hashed
 * mixing matrix, not learned weights. Phase 2's training pipeline replaces the
 * projection with a trained encoder behind this exact signature; the contract
 * (mel stats → unit vector) is what downstream code depends on, not the weights.
 */

import { cosineSimilarity, l2Normalize, melSpectrogram, mulberry32 } from './audio-frames';
import type { PcmAudio, SpeakerEmbedding, SpeakerEncoderOptions } from './types';

const DEFAULT_EMBEDDING_DIM = 256;

/**
 * Extract a speaker embedding from a reference sample. Empty/near-silent audio
 * yields a zero vector (every downstream conditioning step degrades to
 * "speaker-neutral" rather than throwing).
 */
export function encodeSpeaker(
  reference: PcmAudio,
  options: SpeakerEncoderOptions = {},
): SpeakerEmbedding {
  const embeddingDim = options.embeddingDim ?? DEFAULT_EMBEDDING_DIM;
  const sampleRate = options.sampleRate ?? reference.sampleRate;
  const numMels = options.numMels;

  const mel = melSpectrogram(reference.samples, { sampleRate, ...(numMels ? { numMels } : {}) });
  if (mel.frames.length === 0) {
    return { data: new Array(embeddingDim).fill(0), dim: embeddingDim, sampleRate };
  }

  // ── Statistics pooling: mean + std per mel band across all frames. ──
  const m = mel.numMels;
  const mean = new Float32Array(m);
  for (const frame of mel.frames) {
    for (let i = 0; i < m; i++) mean[i] += frame[i];
  }
  for (let i = 0; i < m; i++) mean[i] /= mel.frames.length;

  const std = new Float32Array(m);
  for (const frame of mel.frames) {
    for (let i = 0; i < m; i++) {
      const d = frame[i] - mean[i];
      std[i] += d * d;
    }
  }
  for (let i = 0; i < m; i++) std[i] = Math.sqrt(std[i] / mel.frames.length);

  // Concatenated [mean ⊕ std] is the 2*m utterance-level statistic vector.
  const stats = new Float32Array(2 * m);
  stats.set(mean, 0);
  stats.set(std, m);

  // ── Fixed hashed projection to embeddingDim (no learned weights). ──
  const projected = projectStats(stats, embeddingDim);
  l2Normalize(projected);

  return { data: Array.from(projected), dim: embeddingDim, sampleRate };
}

/**
 * Deterministic dense projection `stats(2m) → out(embeddingDim)` using a seeded
 * ±1 sign matrix (a fixed random projection / Johnson–Lindenstrauss sketch).
 * Distance-preserving, so distinct voices land at distinct, well-separated
 * points — the property the acoustic model's conditioning relies on. Cached per
 * (inputDim, outDim) so re-analysing many clips doesn't rebuild the matrix.
 */
const projectionCache = new Map<string, Int8Array>();
function projectStats(stats: Float32Array, outDim: number): Float32Array {
  const inDim = stats.length;
  const key = `${inDim}:${outDim}`;
  let signs = projectionCache.get(key);
  if (!signs) {
    signs = new Int8Array(inDim * outDim);
    const rand = mulberry32((0x9e3779b9 ^ Math.imul(inDim, 2654435761) ^ outDim) >>> 0);
    for (let i = 0; i < signs.length; i++) signs[i] = rand() < 0.5 ? -1 : 1;
    projectionCache.set(key, signs);
  }
  const out = new Float32Array(outDim);
  const scale = 1 / Math.sqrt(inDim);
  for (let o = 0; o < outDim; o++) {
    let sum = 0;
    const base = o * inDim;
    for (let i = 0; i < inDim; i++) sum += signs[base + i] * stats[i];
    out[o] = sum * scale;
  }
  return out;
}

/**
 * Verify two embeddings plausibly belong to the same speaker. Cosine ≥
 * `threshold` (default 0.75) → same voice. Used by the server publish/consent
 * gate (re-uploading must match the enrolled identity) and by tests.
 */
export function verifySpeaker(
  a: SpeakerEmbedding,
  b: SpeakerEmbedding,
  threshold = 0.75,
): { same: boolean; similarity: number } {
  const similarity = cosineSimilarity(a.data, b.data);
  return { same: similarity >= threshold, similarity };
}

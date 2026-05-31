/**
 * FrameInterpolator — keyframe → in-between generation in VAE latent space.
 *
 * The expensive part of diffusion video is the UNet denoise loop, run once per
 * frame. The feedback's key insight: don't run it per frame. Generate sparse
 * KEYFRAMES with the full denoise loop, then synthesize the frames between them
 * cheaply. Here "cheaply" = spherical-linear interpolation (slerp) of the two
 * neighbouring clean latents, followed by a single VAE decode per tween.
 *
 * Why slerp and not linear (lerp): diffusion latents live on (approximately) a
 * hypersphere — they're high-dimensional near-unit-norm Gaussian-ish vectors.
 * Linear interpolation cuts a chord through the sphere, shrinking the norm at
 * the midpoint (||0.5a + 0.5b|| < 1), which decodes to a washed-out, low-
 * contrast tween. Slerp walks the great-circle arc, preserving norm, so the
 * tween decodes at the same fidelity as its keyframes. This is the same reason
 * latent-space image-morph demos use slerp.
 *
 * This module is pure (no ORT, no network) so it is fully unit-tested. The VAE
 * decode of each interpolated latent is the engine's job (DiffusionEngine.
 * decodeLatent) — keeping the math here separable from the GPU work.
 *
 * A true optical-flow interpolator (RIFE / FILM) would produce physically
 * correct motion rather than latent morph; that needs a separate ONNX model +
 * session and is logged in the Consolidated Gap Register. Latent slerp ships
 * today with zero extra weights.
 */

/**
 * Spherical-linear interpolation between two equal-length vectors at fraction
 * `t` ∈ [0, 1]. `t = 0` → exactly `a`, `t = 1` → exactly `b`. Falls back to
 * linear interpolation when the two vectors are nearly collinear (the arc is
 * degenerate and slerp's `sin(theta)` denominator → 0).
 */
export function slerp(a: Float32Array, b: Float32Array, t: number): Float32Array {
  if (a.length !== b.length) {
    throw new Error(`slerp: length mismatch (${a.length} vs ${b.length})`);
  }
  if (t <= 0) return new Float32Array(a);
  if (t >= 1) return new Float32Array(b);

  // Cosine of the angle between a and b via the normalised dot product.
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB) || 1;
  let cosTheta = dot / denom;
  if (cosTheta > 1) cosTheta = 1;
  if (cosTheta < -1) cosTheta = -1;

  const theta = Math.acos(cosTheta);
  const sinTheta = Math.sin(theta);
  const out = new Float32Array(a.length);

  // Near-collinear (sinTheta ≈ 0): the arc collapses, slerp is numerically
  // unstable — lerp is the correct limit and is what slerp converges to.
  if (sinTheta < 1e-4) {
    for (let i = 0; i < a.length; i++) {
      out[i] = a[i] * (1 - t) + b[i] * t;
    }
    return out;
  }

  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  for (let i = 0; i < a.length; i++) {
    out[i] = wa * a[i] + wb * b[i];
  }
  return out;
}

/**
 * Decide which FINAL frame indices are generated as keyframes (full denoise)
 * given the desired total and an interpolation factor. The remaining indices
 * are filled by interpolation.
 *
 * Contract:
 *   • index 0 is ALWAYS a keyframe.
 *   • the LAST index is ALWAYS a keyframe (so the clip ends on real content,
 *     not a tween extrapolated past the final keyframe).
 *   • interior keyframes are spaced ~`factor` apart.
 *
 * Examples (totalFrames, factor) → indices:
 *   (8, 2) → [0, 2, 4, 6, 7]   (every other, last pinned)
 *   (9, 4) → [0, 4, 8]
 *   (5, 1) → [0, 1, 2, 3, 4]   (factor 1 = every frame is a keyframe)
 */
export function planKeyframeIndices(totalFrames: number, factor: number): number[] {
  const total = Math.max(0, Math.floor(totalFrames));
  if (total === 0) return [];
  if (total === 1) return [0];
  const step = Math.max(1, Math.floor(factor));
  if (step === 1) return Array.from({ length: total }, (_, i) => i);

  const indices: number[] = [];
  for (let i = 0; i < total; i += step) indices.push(i);
  const last = total - 1;
  if (indices[indices.length - 1] !== last) indices.push(last);
  return indices;
}

/** A keyframe paired with the FINAL output index it occupies. */
export interface Keyframe {
  /** Position in the final frame sequence (from `planKeyframeIndices`). */
  outputIndex: number;
  /** The keyframe's clean (post-denoise) latent — the slerp endpoints. */
  latent: Float32Array;
}

/** One frame slot in the fully-expanded sequence: either an existing keyframe
 *  (already decoded by the engine) or a tween latent the engine must decode. */
export interface InterpolatedSlot {
  outputIndex: number;
  /** When true, `latent` is a freshly-slerped tween that needs a VAE decode.
   *  When false, this slot is a keyframe the engine already decoded. */
  isTween: boolean;
  /** Index into the ORIGINAL keyframe array — set only for keyframe slots so
   *  the engine can reuse the already-decoded pixels instead of re-decoding. */
  keyframeIndex?: number;
  /** The latent for tween slots (slerp result). Undefined for keyframe slots. */
  latent?: Float32Array;
}

/**
 * Expand a sparse keyframe list into the full ordered frame sequence, emitting
 * a slerped tween latent for every gap index. The engine then decodes only the
 * tween latents (keyframes are already decoded), assembling the final clip.
 *
 * Keyframes MUST be sorted ascending by `outputIndex` and the first must be
 * index 0. The fraction for a tween at output index `x` between keyframes at
 * `k0` and `k1` is `(x - k0) / (k1 - k0)` — evenly spaced in output time.
 */
export function buildInterpolatedSequence(keyframes: Keyframe[]): InterpolatedSlot[] {
  if (keyframes.length === 0) return [];
  if (keyframes.length === 1) {
    return [{ outputIndex: keyframes[0].outputIndex, isTween: false, keyframeIndex: 0 }];
  }

  const slots: InterpolatedSlot[] = [];
  for (let k = 0; k < keyframes.length - 1; k++) {
    const k0 = keyframes[k];
    const k1 = keyframes[k + 1];
    // Emit the left keyframe, then every tween strictly between k0 and k1.
    slots.push({ outputIndex: k0.outputIndex, isTween: false, keyframeIndex: k });
    const span = k1.outputIndex - k0.outputIndex;
    for (let x = k0.outputIndex + 1; x < k1.outputIndex; x++) {
      const t = (x - k0.outputIndex) / span;
      slots.push({ outputIndex: x, isTween: true, latent: slerp(k0.latent, k1.latent, t) });
    }
  }
  // The final keyframe closes the sequence.
  const lastIdx = keyframes.length - 1;
  slots.push({
    outputIndex: keyframes[lastIdx].outputIndex,
    isTween: false,
    keyframeIndex: lastIdx,
  });
  return slots;
}

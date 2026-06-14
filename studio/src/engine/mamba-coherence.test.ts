import { describe, it, expect } from 'vitest';
import {
  anchorWalkLatent,
  applyToLatent,
  blendNoise,
  isAnchorRefreshFrame,
  latentResidualBiasScale,
  scaleLatent,
  shiftLatent,
} from './mamba-coherence';
import type { MambaStateSnapshot } from '../types';

/**
 * blendNoise is the latent-walk primitive VideoEngine.generate uses to keep
 * video frames visually continuous (locked colors / composition) instead of
 * sampling fresh i.i.d. noise per frame — which is the bug this guards:
 * each frame became a totally fresh interpretation of the prompt because
 * the diffusion process is dominated by the initial noise.
 *
 * The invariants below define the function's contract. The actual end-to-end
 * "two consecutive frames look related" effect is enforced by VideoEngine
 * always using one anchor latent + per-frame blendNoise() inside the loop
 * (see video-engine.ts — search for `anchorLatent`).
 */
describe('blendNoise (latent-walk continuity primitive)', () => {
  function gaussian(length: number, seed: number): Float32Array {
    // Tiny Box-Muller PRNG. Tests need deterministic noise samples, not a real
    // gaussian — same shape as DiffusionEngine.sampleInitialLatent, sufficient
    // for the contract assertions here.
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

  it('alpha = 0 returns the anchor unchanged (every frame would be identical)', () => {
    const anchor = gaussian(256, 1);
    const frame = gaussian(256, 2);
    const out = blendNoise(anchor, frame, 0);
    for (let i = 0; i < 256; i++) expect(out[i]).toBe(anchor[i]);
  });

  it('alpha = 1 returns the frame unchanged (the broken i.i.d. baseline)', () => {
    const anchor = gaussian(256, 1);
    const frame = gaussian(256, 2);
    const out = blendNoise(anchor, frame, 1);
    for (let i = 0; i < 256; i++) expect(out[i]).toBe(frame[i]);
  });

  it('alpha = 0.15 (default motionAmount) leaves the result mostly the anchor', () => {
    // Cosine similarity between output and anchor should be high; between
    // output and frame should be low. This is the property that delivers
    // the user-visible "consecutive frames share a color palette" behaviour.
    const anchor = gaussian(4096, 1);
    const frame = gaussian(4096, 2);
    const out = blendNoise(anchor, frame, 0.15);

    expect(cosineSim(out, anchor)).toBeGreaterThan(0.9);
    expect(cosineSim(out, frame)).toBeLessThan(0.5);
  });

  it('preserves unit variance (scheduler expects unit-variance noise)', () => {
    // sqrt(1-α) * a + sqrt(α) * b with independent unit-variance a, b
    // has unit variance. Verify empirically across a few alpha values.
    const anchor = gaussian(8192, 1);
    const frame = gaussian(8192, 2);
    for (const alpha of [0.05, 0.15, 0.5, 0.85]) {
      const out = blendNoise(anchor, frame, alpha);
      const v = variance(out);
      expect(
        Math.abs(v - 1),
        `alpha=${alpha} produced variance ${v.toFixed(3)} (want ~1.0)`,
      ).toBeLessThan(0.1);
    }
  });

  it('two frames with different per-frame noise but the same anchor stay highly correlated', () => {
    // This is the end-state property the engine relies on: at default
    // motionAmount, consecutive frames sampling DIFFERENT per-frame noise
    // still share most of the anchor — that's why color palette + composition
    // hold across frames. Drop this test would let the engine silently regress
    // back to i.i.d. frames if some refactor reshuffled the blendNoise call.
    const anchor = gaussian(4096, 1);
    const frameA = gaussian(4096, 2);
    const frameB = gaussian(4096, 3);
    const a = blendNoise(anchor, frameA, 0.15);
    const b = blendNoise(anchor, frameB, 0.15);
    expect(
      cosineSim(a, b),
      'Two frames sharing the anchor must remain highly correlated at default motionAmount',
    ).toBeGreaterThan(0.8);
  });

  it('throws on length mismatch (registry/engine drift catcher)', () => {
    expect(() => blendNoise(new Float32Array(10), new Float32Array(20), 0.5)).toThrow(
      /length mismatch/,
    );
  });
});

describe('anchorWalkLatent (smooth-motion trajectory primitive)', () => {
  // Deterministic, well-separated endpoint noises so the arc is non-degenerate.
  const N = 64;
  function ramp(scale: number, phase: number): Float32Array {
    const a = new Float32Array(N);
    for (let i = 0; i < N; i++) a[i] = Math.sin((i + phase) * scale);
    return a;
  }
  const anchor = ramp(0.10, 0);
  const walkStart = ramp(0.30, 1);
  const walkEnd = ramp(0.07, 9);

  function dist(a: Float32Array, b: Float32Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
    return Math.sqrt(s);
  }

  // THE invariant this whole change exists to deliver: consecutive frames must
  // be CLOSER to each other than far-apart frames. The pre-fix i.i.d.-per-frame
  // path failed this (frame k↔k+1 was as far as k↔k+10), which read as flicker.
  it('consecutive frames are nearer than distant frames (incremental motion)', () => {
    const total = 16;
    const f = (i: number) => anchorWalkLatent(anchor, walkStart, walkEnd, i, total, 0.15);
    const adjacent = dist(f(7), f(8));
    const distant = dist(f(0), f(15));
    expect(adjacent).toBeLessThan(distant);
    // And the very next frame is a small step, not a random jump near the full span.
    expect(adjacent).toBeLessThan(distant / 3);
  });

  it('step size shrinks as frame count grows (more frames = smoother)', () => {
    const stepAt = (total: number) =>
      dist(
        anchorWalkLatent(anchor, walkStart, walkEnd, 0, total, 0.15),
        anchorWalkLatent(anchor, walkStart, walkEnd, 1, total, 0.15),
      );
    expect(stepAt(32)).toBeLessThan(stepAt(8));
  });

  it('motionAmount = 0 collapses to the pure anchor (no motion)', () => {
    const out = anchorWalkLatent(anchor, walkStart, walkEnd, 5, 16, 0);
    expect(Array.from(out)).toEqual(Array.from(anchor));
  });

  it('single-frame clip is well-defined (t=0, no divide-by-zero)', () => {
    const out = anchorWalkLatent(anchor, walkStart, walkEnd, 0, 1, 0.15);
    expect(out.length).toBe(N);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('isAnchorRefreshFrame (img2img-drift bound)', () => {
  it('never refreshes when the interval is 0 / negative / non-finite (default: carry forward)', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      for (let k = 0; k < 40; k++) {
        expect(isAnchorRefreshFrame(k, bad)).toBe(false);
      }
    }
  });

  it('refreshes on multiples of the interval but never on keyframe 0 (which starts fresh already)', () => {
    expect(isAnchorRefreshFrame(0, 8)).toBe(false);
    expect(isAnchorRefreshFrame(8, 8)).toBe(true);
    expect(isAnchorRefreshFrame(16, 8)).toBe(true);
    // Between refreshes the recursion is left to carry content forward.
    for (const k of [1, 2, 7, 9, 15]) expect(isAnchorRefreshFrame(k, 8)).toBe(false);
  });

  it('floors a fractional interval to whole keyframes', () => {
    // interval 4.9 → effective 4: refresh on 4, 8, 12.
    expect(isAnchorRefreshFrame(4, 4.9)).toBe(true);
    expect(isAnchorRefreshFrame(8, 4.9)).toBe(true);
    expect(isAnchorRefreshFrame(5, 4.9)).toBe(false);
  });

  it('caps accumulated drift: at least one refresh occurs within any window of `interval` keyframes', () => {
    const interval = 8;
    for (let start = 1; start <= 30; start++) {
      const window = Array.from({ length: interval }, (_, i) => start + i);
      expect(window.some((k) => isAnchorRefreshFrame(k, interval))).toBe(true);
    }
  });
});

describe('shiftLatent (img2img camera-motion primitive)', () => {
  // NCHW layout: 2 channels, 3 rows, 3 cols. Channel 0 = 1..9, channel 1 = 11..19.
  function fixture(): Float32Array {
    return new Float32Array([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
      11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  }
  const shape = { channels: 2, height: 3, width: 3 };

  it('dx=0, dy=0 returns a copy of the input (no-op)', () => {
    const src = fixture();
    const out = shiftLatent(src, shape, 0, 0);
    expect(Array.from(out)).toEqual(Array.from(src));
    expect(out).not.toBe(src); // a copy, not the same reference
  });

  it('dx=1 shifts content one column right, leftmost column replicates the left edge (no black band)', () => {
    // Edge-replicate: output column 0 mirrors input column 0 instead of zero.
    // This was the bug — zero-filled edges produced a black band on every
    // img2img-recursion frame that the truncated denoise couldn't repair.
    const out = shiftLatent(fixture(), shape, 1, 0);
    expect(Array.from(out.slice(0, 9))).toEqual([1, 1, 2, 4, 4, 5, 7, 7, 8]);
    expect(Array.from(out.slice(9))).toEqual([11, 11, 12, 14, 14, 15, 17, 17, 18]);
  });

  it('dy=-1 shifts content one row up, bottom row replicates the bottom edge', () => {
    const out = shiftLatent(fixture(), shape, 0, -1);
    expect(Array.from(out.slice(0, 9))).toEqual([4, 5, 6, 7, 8, 9, 7, 8, 9]);
    expect(Array.from(out.slice(9))).toEqual([14, 15, 16, 17, 18, 19, 17, 18, 19]);
  });

  it('throws on length/shape mismatch (engine ⇄ helper drift catcher)', () => {
    expect(() => shiftLatent(new Float32Array(10), shape, 0, 0)).toThrow(
      /doesn't match shape/,
    );
  });

  it('shift larger than the frame replicates the corner pixel everywhere (clamp behaviour)', () => {
    // With clamp padding, a giant rightward shift means every output pixel
    // samples from the leftmost source column. So channel 0's plane fills
    // with [1,1,1, 4,4,4, 7,7,7] (column 0 replicated across all output cols).
    const out = shiftLatent(fixture(), shape, 99, 0);
    expect(Array.from(out.slice(0, 9))).toEqual([1, 1, 1, 4, 4, 4, 7, 7, 7]);
    expect(Array.from(out.slice(9))).toEqual([11, 11, 11, 14, 14, 14, 17, 17, 17]);
  });
});

describe('scaleLatent (dolly / latent-zoom primitive)', () => {
  const shape = { channels: 1, height: 4, width: 4 };

  it('scale = 1 returns the latent unchanged', () => {
    const l = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(Array.from(scaleLatent(l, shape, 1))).toEqual(Array.from(l));
  });

  it('zooming in stays finite and within the source value range (edge-clamped, no overshoot)', () => {
    const l = Float32Array.from([
      0, 1, 2, 3,
      0, 1, 2, 3,
      0, 1, 2, 3,
      0, 1, 2, 3,
    ]);
    const zoomed = scaleLatent(l, shape, 2);
    expect(zoomed.every((v) => Number.isFinite(v))).toBe(true);
    // Bilinear + edge-clamp can never produce a value outside the source range.
    expect(Math.min(...zoomed)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...zoomed)).toBeLessThanOrEqual(3);
  });

  it('clamps out-of-bounds reads to the edge when zooming out (no black border)', () => {
    const l = new Float32Array(16).fill(5);
    const out = scaleLatent(l, shape, 0.5);
    expect(out.every((v) => Math.abs(v - 5) < 1e-6)).toBe(true);
  });

  it('throws on shape/length mismatch', () => {
    expect(() => scaleLatent(new Float32Array(10), shape, 2)).toThrow(/doesn't match shape/);
  });
});

describe('latentResidualBiasScale (img2img-composable bias gate)', () => {
  // History: the latent-residual Mamba bias is a constant per-channel offset
  // broadcast to every pixel — designed for unit-variance noise (frame 0 /
  // anchor-walk). Applying it at full strength to a partially-denoised img2img
  // latent shifted the SIGNAL out of the UNet's trained range and disfigured
  // every frame after the first, compounding as Mamba state accumulated. The
  // first fix SKIPPED the bias entirely under img2img (coherence lost there).
  // The proper fix scales the bias by the latent's noise fraction sqrt(1-ᾱ_t)
  // so it perturbs only the noise component — letting latent-residual coherence
  // and img2img recursion finally compose. This helper is the SINGLE place that
  // rule lives; this suite locks it against regressing to either prior state.

  it('full bias under latent-residual + fresh-noise (pure unit-variance latent)', () => {
    expect(latentResidualBiasScale('latent-residual', false, 1)).toBe(1);
  });

  it('scales bias by the noise fraction under latent-residual + img2img (the fix)', () => {
    // A mid-schedule img2img re-noise (sqrt(1-ᾱ_t) ≈ 0.6) → partial, not zero,
    // not full. This is what lets both mechanisms coexist.
    expect(latentResidualBiasScale('latent-residual', true, 0.6)).toBeCloseTo(0.6, 6);
  });

  it('never exceeds 1 even if a degenerate noise scale is passed', () => {
    expect(latentResidualBiasScale('latent-residual', true, 5)).toBe(1);
  });

  it('skips bias when the img2img noise fraction is ~0 (latent is essentially clean signal)', () => {
    expect(latentResidualBiasScale('latent-residual', true, 0)).toBe(0);
    expect(latentResidualBiasScale('latent-residual', true, NaN)).toBe(0);
  });

  it('never applies bias under prompt-bias (mode is a no-op on the latent path)', () => {
    expect(latentResidualBiasScale('prompt-bias', false, 1)).toBe(0);
    expect(latentResidualBiasScale('prompt-bias', true, 0.6)).toBe(0);
  });
});

describe('applyToLatent (noise-scaled per-channel bias)', () => {
  const state: MambaStateSnapshot = {
    data: [0.5, -0.3, 0.8, -0.1, 0.2, 0.6, -0.4, 0.9],
    dim: 64,
    order: 2,
    channels: 4,
    step: 3,
  };
  // 4 channels × 4 spatial positions = 16, matching the engine's NCHW latent.
  const latent = () => new Float32Array(16).fill(0);

  it('noiseScale defaults to 1 — backward-compatible full bias', () => {
    const withDefault = applyToLatent({ ctx: { mode: 'latent-residual', strength: 0.5, state }, latent: latent() });
    const withExplicit = applyToLatent({
      ctx: { mode: 'latent-residual', strength: 0.5, state },
      latent: latent(),
      noiseScale: 1,
    });
    expect(Array.from(withDefault)).toEqual(Array.from(withExplicit));
  });

  it('a smaller noiseScale produces a proportionally smaller offset (perturbs only the noise portion)', () => {
    const full = applyToLatent({ ctx: { mode: 'latent-residual', strength: 0.5, state }, latent: latent(), noiseScale: 1 });
    const half = applyToLatent({ ctx: { mode: 'latent-residual', strength: 0.5, state }, latent: latent(), noiseScale: 0.5 });
    // Every non-zero offset under half-scale is exactly half the full-scale one.
    for (let i = 0; i < full.length; i++) {
      expect(half[i]).toBeCloseTo(full[i] * 0.5, 6);
    }
    // And the bias is actually non-trivial (guards against a no-op test).
    expect(full.some((v) => Math.abs(v) > 1e-6)).toBe(true);
  });

  it('noiseScale = 0 is a no-op (returns the latent untouched)', () => {
    const l = latent();
    const out = applyToLatent({ ctx: { mode: 'latent-residual', strength: 0.5, state }, latent: l, noiseScale: 0 });
    expect(out).toBe(l);
  });
});

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function variance(a: Float32Array): number {
  let mean = 0;
  for (let i = 0; i < a.length; i++) mean += a[i];
  mean /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - mean) * (a[i] - mean);
  return v / a.length;
}

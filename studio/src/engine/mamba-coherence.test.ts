import { describe, it, expect } from 'vitest';
import { blendNoise, shiftLatent } from './mamba-coherence';

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

  it('dx=1 shifts content one column right, leftmost column zero-filled', () => {
    const out = shiftLatent(fixture(), shape, 1, 0);
    expect(Array.from(out.slice(0, 9))).toEqual([0, 1, 2, 0, 4, 5, 0, 7, 8]);
    expect(Array.from(out.slice(9))).toEqual([0, 11, 12, 0, 14, 15, 0, 17, 18]);
  });

  it('dy=-1 shifts content one row up, bottom row zero-filled (camera tilts up)', () => {
    const out = shiftLatent(fixture(), shape, 0, -1);
    expect(Array.from(out.slice(0, 9))).toEqual([4, 5, 6, 7, 8, 9, 0, 0, 0]);
    expect(Array.from(out.slice(9))).toEqual([14, 15, 16, 17, 18, 19, 0, 0, 0]);
  });

  it('throws on length/shape mismatch (engine ⇄ helper drift catcher)', () => {
    expect(() => shiftLatent(new Float32Array(10), shape, 0, 0)).toThrow(
      /doesn't match shape/,
    );
  });

  it('shift larger than the frame zero-fills the entire output', () => {
    const out = shiftLatent(fixture(), shape, 99, 0);
    expect(out.every((v) => v === 0)).toBe(true);
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

import { describe, expect, it } from 'vitest';
import {
  alphaCumprodAt,
  applyGuidance,
  forwardDiffuse,
  gaussianNoise,
  lcmStep,
  noiseScaleAt,
} from './diffusion-schedule';

describe('alphaCumprodAt', () => {
  it('is monotonically decreasing across the schedule', () => {
    expect(alphaCumprodAt(0)).toBeGreaterThan(alphaCumprodAt(500));
    expect(alphaCumprodAt(500)).toBeGreaterThan(alphaCumprodAt(999));
  });

  it('clamps out-of-range and fractional timesteps instead of reading undefined', () => {
    // The old lookup was `ALPHAS_CUMPROD[t] ?? 0.001`: a fractional or ≥1000
    // timestep silently became ᾱ=0.001 (near-pure noise).
    expect(alphaCumprodAt(1000)).toBe(alphaCumprodAt(999));
    expect(alphaCumprodAt(-5)).toBe(alphaCumprodAt(0));
    expect(alphaCumprodAt(759.4)).toBe(alphaCumprodAt(759));
  });

  it('noiseScaleAt is sqrt(1 − ᾱ)', () => {
    expect(noiseScaleAt(500)).toBeCloseTo(Math.sqrt(1 - alphaCumprodAt(500)), 6);
  });
});

describe('lcmStep', () => {
  it('on the last step recovers x0 exactly when the noise prediction is the true noise', () => {
    const x0 = gaussianNoise(64, 1);
    const eps = gaussianNoise(64, 2);
    const t = 759;
    const noisy = forwardFromNoise(x0, eps, t);
    lcmStep(noisy, eps, t, null, 0, 0);
    for (let i = 0; i < x0.length; i++) expect(noisy[i]).toBeCloseTo(x0[i]!, 4);
  });

  it('re-noises to the next timestep in place, deterministically per (seed, step)', () => {
    const a = gaussianNoise(64, 3);
    const b = new Float32Array(a);
    const eps = gaussianNoise(64, 4);
    lcmStep(a, eps, 999, 759, 42, 1);
    lcmStep(b, eps, 999, 759, 42, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = gaussianNoise(64, 3);
    lcmStep(c, eps, 999, 759, 42, 2);
    expect(Array.from(c)).not.toEqual(Array.from(a));
  });
});

describe('applyGuidance', () => {
  it('mixes uncond + w·(cond − uncond) in place', () => {
    const cond = new Float32Array([2, 4]);
    applyGuidance(cond, new Float32Array([1, 1]), 3);
    expect(Array.from(cond)).toEqual([4, 10]);
  });
});

describe('forwardDiffuse', () => {
  it('does not mutate the clean latent', () => {
    const clean = gaussianNoise(32, 9);
    const copy = new Float32Array(clean);
    forwardDiffuse(clean, 500, 1);
    expect(Array.from(clean)).toEqual(Array.from(copy));
  });
});

function forwardFromNoise(x0: Float32Array, eps: Float32Array, t: number): Float32Array {
  const a = alphaCumprodAt(t);
  return x0.map((v, i) => Math.sqrt(a) * v + Math.sqrt(1 - a) * eps[i]!);
}

import { describe, it, expect } from 'vitest';
import {
  slerp,
  planKeyframeIndices,
  buildInterpolatedSequence,
  type Keyframe,
} from './frame-interpolator';

describe('slerp (latent interpolation primitive)', () => {
  it('t=0 returns a, t=1 returns b (exact endpoints)', () => {
    const a = Float32Array.from([1, 0, 0, 0]);
    const b = Float32Array.from([0, 1, 0, 0]);
    expect(Array.from(slerp(a, b, 0))).toEqual([1, 0, 0, 0]);
    expect(Array.from(slerp(a, b, 1))).toEqual([0, 1, 0, 0]);
  });

  it('preserves norm at the midpoint (the whole reason to use slerp over lerp)', () => {
    // Two orthogonal unit vectors: lerp midpoint norm = sqrt(0.5) ≈ 0.707
    // (washed-out decode); slerp midpoint must stay ≈ 1.
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([0, 1]);
    const mid = slerp(a, b, 0.5);
    const norm = Math.sqrt(mid[0] ** 2 + mid[1] ** 2);
    expect(norm).toBeCloseTo(1, 5);
  });

  it('falls back to lerp when vectors are collinear (degenerate arc, no NaN)', () => {
    const a = Float32Array.from([2, 4, 6]);
    const b = Float32Array.from([4, 8, 12]); // exactly 2x → angle 0
    const mid = slerp(a, b, 0.5);
    // Lerp midpoint: (3, 6, 9). Must be finite, no division-by-sinTheta NaN.
    expect(Array.from(mid)).toEqual([3, 6, 9]);
    expect(mid.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('throws on length mismatch', () => {
    expect(() => slerp(new Float32Array(3), new Float32Array(4), 0.5)).toThrow(/length mismatch/);
  });
});

describe('planKeyframeIndices (keyframe scheduling)', () => {
  it('factor 1 makes every frame a keyframe (no interpolation)', () => {
    expect(planKeyframeIndices(5, 1)).toEqual([0, 1, 2, 3, 4]);
  });

  it('always pins index 0 and the last index as keyframes', () => {
    const idx = planKeyframeIndices(8, 2);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(7);
    // Last frame must be real content, not a tween past the final keyframe.
    expect(idx).toEqual([0, 2, 4, 6, 7]);
  });

  it('spaces interior keyframes ~factor apart', () => {
    expect(planKeyframeIndices(9, 4)).toEqual([0, 4, 8]);
  });

  it('handles degenerate counts', () => {
    expect(planKeyframeIndices(0, 2)).toEqual([]);
    expect(planKeyframeIndices(1, 4)).toEqual([0]);
  });

  it('a higher factor produces strictly fewer keyframes (the compute saving)', () => {
    const total = 24;
    expect(planKeyframeIndices(total, 4).length).toBeLessThan(
      planKeyframeIndices(total, 2).length,
    );
  });
});

describe('buildInterpolatedSequence', () => {
  function kf(outputIndex: number, fill: number): Keyframe {
    return { outputIndex, latent: Float32Array.from([fill, fill, fill, fill]) };
  }

  it('emits a contiguous, ordered, complete frame sequence', () => {
    const seq = buildInterpolatedSequence([kf(0, 1), kf(2, 2), kf(4, 3)]);
    expect(seq.map((s) => s.outputIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('marks generated keyframes as non-tween and tweens as tween', () => {
    const seq = buildInterpolatedSequence([kf(0, 1), kf(2, 2)]);
    expect(seq.find((s) => s.outputIndex === 0)?.isTween).toBe(false);
    expect(seq.find((s) => s.outputIndex === 1)?.isTween).toBe(true);
    expect(seq.find((s) => s.outputIndex === 2)?.isTween).toBe(false);
  });

  it('keyframe slots carry the index back into the original keyframe array', () => {
    const seq = buildInterpolatedSequence([kf(0, 1), kf(2, 2), kf(4, 3)]);
    const keyframeSlots = seq.filter((s) => !s.isTween);
    expect(keyframeSlots.map((s) => s.keyframeIndex)).toEqual([0, 1, 2]);
  });

  it('tween latents are produced for every gap index', () => {
    const seq = buildInterpolatedSequence([kf(0, 1), kf(4, 5)]);
    const tweens = seq.filter((s) => s.isTween);
    expect(tweens).toHaveLength(3); // indices 1,2,3
    for (const t of tweens) {
      expect(t.latent).toBeInstanceOf(Float32Array);
      expect(t.latent!.length).toBe(4);
    }
  });

  it('single keyframe collapses to one decoded slot', () => {
    const seq = buildInterpolatedSequence([kf(0, 1)]);
    expect(seq).toEqual([{ outputIndex: 0, isTween: false, keyframeIndex: 0 }]);
  });
});

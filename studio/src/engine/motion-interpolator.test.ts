import { describe, it, expect } from 'vitest';
import { luma, estimateBlockMotion, interpolateFrames } from './motion-interpolator';

/**
 * The motion backend's contract: recover real translation between two frames
 * and warp along it, so a moving subject slides between keyframes instead of
 * cross-fading (the latent-slerp failure mode). We build a synthetic frame and
 * a shifted copy, then assert (a) the estimated motion ≈ the true shift and
 * (b) the t=0.5 tween places the subject at the half-way position.
 */

const W = 32;
const H = 32;
const N = W * H;

/** A planar-RGB [-1..1] frame with a bright 6x6 square at (sx, sy). */
function frameWithSquare(sx: number, sy: number): Float32Array {
  const f = new Float32Array(3 * N).fill(-1); // black background
  for (let y = sy; y < sy + 6; y++) {
    for (let x = sx; x < sx + 6; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const p = y * W + x;
      f[p] = 1; // R
      f[N + p] = 1; // G
      f[2 * N + p] = 1; // B
    }
  }
  return f;
}

/** Centroid of the bright region on the luma plane. */
function centroid(frame: Float32Array): { x: number; y: number } {
  const l = luma(frame, W, H);
  let sx = 0;
  let sy = 0;
  let m = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = l[y * W + x] + 1; // shift to [0,2] so background contributes ~0 weight after threshold
      if (v > 1.5) {
        sx += x;
        sy += y;
        m += 1;
      }
    }
  }
  return m > 0 ? { x: sx / m, y: sy / m } : { x: -1, y: -1 };
}

describe('luma', () => {
  it('throws on a wrong-sized buffer', () => {
    expect(() => luma(new Float32Array(10), W, H)).toThrow(/expected/);
  });
});

describe('estimateBlockMotion (block optical flow)', () => {
  it('recovers a known horizontal translation', () => {
    const a = frameWithSquare(8, 12);
    const b = frameWithSquare(14, 12); // shifted +6 in x
    const field = estimateBlockMotion(a, b, W, H, { blockSize: 8, searchRadius: 8 });
    // The block covering the square should report dx ≈ +6 (A→B), dy ≈ 0.
    const bx = Math.floor(10 / 8);
    const by = Math.floor(14 / 8);
    const bi = (by * field.cols + bx) * 2;
    expect(field.vec[bi]).toBeGreaterThanOrEqual(4);
    expect(Math.abs(field.vec[bi + 1])).toBeLessThanOrEqual(1);
  });

  it('reports ~zero motion for identical frames (tie-break prefers static)', () => {
    const a = frameWithSquare(10, 10);
    const field = estimateBlockMotion(a, a, W, H, { blockSize: 8, searchRadius: 6 });
    expect(Array.from(field.vec).every((v) => v === 0)).toBe(true);
  });
});

describe('interpolateFrames (motion-compensated tween)', () => {
  it('t=0.5 places a translating subject at the half-way position (slides, not fades)', () => {
    const a = frameWithSquare(8, 12);
    const b = frameWithSquare(20, 12); // +12 in x
    const field = estimateBlockMotion(a, b, W, H, { blockSize: 8, searchRadius: 12 });
    const mid = interpolateFrames(a, b, W, H, 0.5, field);
    const c = centroid(mid);
    // Square centre starts at x≈10.5 (8..13) and ends at x≈22.5 (20..25); the
    // half-way centre should land near 16.5 — clearly between, not a double image.
    expect(c.x).toBeGreaterThan(13);
    expect(c.x).toBeLessThan(20);
  });

  it('t=0 returns frame A and t=1 returns frame B (endpoints exact under zero motion)', () => {
    const a = frameWithSquare(10, 10);
    const field = estimateBlockMotion(a, a, W, H, { blockSize: 8, searchRadius: 4 });
    const at0 = interpolateFrames(a, a, W, H, 0, field);
    expect(Array.from(at0)).toEqual(Array.from(a));
  });

  it('throws on length mismatch', () => {
    const a = frameWithSquare(4, 4);
    const field = estimateBlockMotion(a, a, W, H);
    expect(() => interpolateFrames(a, new Float32Array(3), W, H, 0.5, field)).toThrow(/length mismatch/);
  });
});

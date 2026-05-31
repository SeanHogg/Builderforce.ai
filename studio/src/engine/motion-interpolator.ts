/**
 * MotionInterpolator — motion-compensated frame interpolation (block optical
 * flow) in PIXEL space. The alternative to the latent-slerp backend.
 *
 * Latent slerp morphs one keyframe into the next; it has no notion of *motion*,
 * so a fast pan reads as a cross-dissolve. This backend instead estimates a
 * per-block motion field between two decoded keyframes (luma SAD block match),
 * then synthesises a tween by bidirectionally warping both keyframes along that
 * motion and blending — the same principle a learned model (RIFE/FILM) uses,
 * minus the learned flow. It produces real displacement, so a translating
 * subject actually slides between keyframes instead of fading.
 *
 * Pure (no ORT, no network), so it's fully unit-tested. It works on the
 * engine's RGB pixel layout: planar Float32 `[3, H, W]`, range [-1..1] (the
 * `pixels` a VAE decode returns). A learned RIFE/FILM ONNX backend can replace
 * `estimateBlockMotion` later behind the same `interpolateFrames` signature —
 * tracked in the Consolidated Gap Register.
 */

/** Per-block motion field: `vec[2*i]` = dx, `vec[2*i+1]` = dy for block i (row-major). */
export interface MotionField {
  blockSize: number;
  cols: number;
  rows: number;
  /** Interleaved (dx, dy) per block, in pixels (A → B displacement). */
  vec: Int16Array;
}

export interface MotionOptions {
  /** Block edge in pixels. Larger = faster + smoother, less detail. Default 16. */
  blockSize?: number;
  /** Max per-axis search displacement in pixels. Default 8. */
  searchRadius?: number;
}

const CHANNELS = 3;

/** Extract a luma (BT.601-ish) plane from planar RGB [-1..1]. Single source of
 *  truth for the "what we match motion on" decision. */
export function luma(rgb: Float32Array, width: number, height: number): Float32Array {
  const n = width * height;
  if (rgb.length !== CHANNELS * n) {
    throw new Error(`luma: expected ${CHANNELS * n} values for ${width}x${height}, got ${rgb.length}`);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.299 * rgb[i] + 0.587 * rgb[n + i] + 0.114 * rgb[2 * n + i];
  }
  return out;
}

/**
 * Estimate an A→B block motion field by minimising sum-of-absolute-differences
 * on the luma plane over a bounded search window. Coarse but deterministic and
 * cheap relative to a full denoise.
 */
export function estimateBlockMotion(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  opts: MotionOptions = {},
): MotionField {
  const blockSize = Math.max(4, Math.floor(opts.blockSize ?? 16));
  const searchRadius = Math.max(1, Math.floor(opts.searchRadius ?? 8));
  const la = luma(a, width, height);
  const lb = luma(b, width, height);
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  const vec = new Int16Array(cols * rows * 2);

  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * blockSize;
      const y0 = by * blockSize;
      const x1 = Math.min(x0 + blockSize, width);
      const y1 = Math.min(y0 + blockSize, height);
      let bestDx = 0;
      let bestDy = 0;
      let bestSad = Infinity;
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          let sad = 0;
          for (let y = y0; y < y1; y++) {
            const sy = clamp(y + dy, 0, height - 1);
            for (let x = x0; x < x1; x++) {
              const sx = clamp(x + dx, 0, width - 1);
              sad += Math.abs(la[y * width + x] - lb[sy * width + sx]);
            }
          }
          // Tie-break toward smaller motion (prefers static over spurious flow).
          if (sad < bestSad - 1e-6 || (Math.abs(sad - bestSad) < 1e-6 && dx * dx + dy * dy < bestDx * bestDx + bestDy * bestDy)) {
            bestSad = sad;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }
      const bi = (by * cols + bx) * 2;
      vec[bi] = bestDx;
      vec[bi + 1] = bestDy;
    }
  }
  return { blockSize, cols, rows, vec };
}

/** Bilinear sample of one channel plane with edge clamp. */
function sampleBilinear(
  plane: Float32Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
): number {
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  const x0 = clamp(Math.floor(fx), 0, width - 1);
  const x1 = clamp(x0 + 1, 0, width - 1);
  const y0 = clamp(Math.floor(fy), 0, height - 1);
  const y1 = clamp(y0 + 1, 0, height - 1);
  const wx = fx - Math.floor(fx);
  const wy = fy - Math.floor(fy);
  const top = plane[y0 * width + x0] * (1 - wx) + plane[y0 * width + x1] * wx;
  const bot = plane[y1 * width + x0] * (1 - wx) + plane[y1 * width + x1] * wx;
  return top * (1 - wy) + bot * wy;
}

/**
 * Synthesise the frame at fraction `t` ∈ (0,1) between keyframes `a` and `b`
 * using motion-compensated bidirectional warping:
 *
 *   out(x) = (1-t)·A(x − t·mv) + t·B(x + (1−t)·mv)
 *
 * where `mv` is the block's A→B displacement. At t=0 this is A, at t=1 it's B;
 * in between, the subject is sampled from where it physically was at time t,
 * so it slides rather than fades. Falls back to a straight cross-fade for any
 * pixel whose block has zero motion (mv=0 → both terms read the same location).
 */
export function interpolateFrames(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  t: number,
  field: MotionField,
): Float32Array {
  if (a.length !== b.length) {
    throw new Error(`interpolateFrames: length mismatch (${a.length} vs ${b.length})`);
  }
  const n = width * height;
  const out = new Float32Array(a.length);
  const { blockSize, cols } = field;
  for (let y = 0; y < height; y++) {
    const by = Math.min(Math.floor(y / blockSize), field.rows - 1);
    for (let x = 0; x < width; x++) {
      const bx = Math.min(Math.floor(x / blockSize), cols - 1);
      const bi = (by * cols + bx) * 2;
      const dx = field.vec[bi];
      const dy = field.vec[bi + 1];
      const ax = x - t * dx;
      const ay = y - t * dy;
      const bxs = x + (1 - t) * dx;
      const bys = y + (1 - t) * dy;
      for (let c = 0; c < CHANNELS; c++) {
        const pa = a.subarray(c * n, (c + 1) * n);
        const pb = b.subarray(c * n, (c + 1) * n);
        const va = sampleBilinear(pa, width, height, ax, ay);
        const vb = sampleBilinear(pb, width, height, bxs, bys);
        out[c * n + (y * width + x)] = (1 - t) * va + t * vb;
      }
    }
  }
  return out;
}

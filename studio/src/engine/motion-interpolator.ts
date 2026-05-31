/**
 * MotionInterpolator — motion-compensated frame interpolation (block optical
 * flow) in PIXEL space. The alternative to the latent-slerp backend.
 *
 * Latent slerp morphs one keyframe into the next; it has no notion of *motion*,
 * so a fast pan reads as a cross-dissolve. This backend instead estimates a
 * per-block motion field between two decoded keyframes, then synthesises a tween
 * by bidirectionally warping both keyframes along that motion and blending — the
 * same principle a learned model (RIFE/FILM) uses, minus the learned flow.
 *
 * The estimator is COARSE-TO-FINE with SUB-PIXEL refinement:
 *   1. a downscaled (coarse) full search captures large motion cheaply — a
 *      ±searchRadius search on a /F plane covers ±searchRadius·F full-res pixels,
 *      so fast pans that a single-level small search would miss are recovered;
 *   2. a small full-resolution search around the upscaled coarse prediction
 *      locks the integer vector precisely;
 *   3. a parabolic fit of the SAD around that minimum yields a SUB-PIXEL offset,
 *      so the warp slides smoothly instead of snapping to whole pixels.
 *
 * Pure (no ORT, no network) so it's fully unit-tested. Works on the engine's RGB
 * pixel layout: planar Float32 `[3, H, W]`, range [-1..1]. A learned RIFE/FILM
 * ONNX backend could replace `estimateBlockMotion` behind the same
 * `interpolateFrames` signature later — tracked in the Consolidated Gap Register.
 */

/** Per-block motion field: `vec[2*i]` = dx, `vec[2*i+1]` = dy for block i
 *  (row-major). Sub-pixel, so values are fractional. */
export interface MotionField {
  blockSize: number;
  cols: number;
  rows: number;
  /** Interleaved sub-pixel (dx, dy) per block, in full-res pixels (A → B). */
  vec: Float32Array;
}

export interface MotionOptions {
  /** Block edge in pixels. Larger = faster + smoother, less detail. Default 16. */
  blockSize?: number;
  /** Max per-axis search displacement, in COARSE-level pixels. The effective
   *  full-res reach is `searchRadius · 2^(levels-1)`. Default 8. */
  searchRadius?: number;
  /** Pyramid levels. 1 = single full-res search (no coarse stage); 3 = /4 coarse
   *  prediction then full-res refine. Default 3. */
  levels?: number;
}

const CHANNELS = 3;
/** Full-res refinement search radius around the coarse prediction (px). */
const FINE_RADIUS = 2;

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

const clampInt = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Downscale a single plane by an integer factor via box averaging. */
function downscale(
  plane: Float32Array,
  width: number,
  height: number,
  factor: number,
): { data: Float32Array; width: number; height: number } {
  if (factor <= 1) return { data: plane, width, height };
  const w2 = Math.max(1, Math.floor(width / factor));
  const h2 = Math.max(1, Math.floor(height / factor));
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = y * factor + dy;
        if (sy >= height) break;
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          if (sx >= width) break;
          sum += plane[sy * width + sx];
          count++;
        }
      }
      out[y * w2 + x] = count > 0 ? sum / count : 0;
    }
  }
  return { data: out, width: w2, height: h2 };
}

/** Sum-of-absolute-differences of block [x0,x1)×[y0,y1) in `a` against the same
 *  block displaced by (dx,dy) in `b`, with edge clamp. */
function blockSad(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dx: number,
  dy: number,
): number {
  let sad = 0;
  for (let y = y0; y < y1; y++) {
    const sy = clampInt(y + dy, 0, height - 1);
    for (let x = x0; x < x1; x++) {
      const sx = clampInt(x + dx, 0, width - 1);
      sad += Math.abs(a[y * width + x] - b[sy * width + sx]);
    }
  }
  return sad;
}

/** Best integer (dx,dy) minimising SAD over a search window centred on
 *  (predictDx, predictDy), tie-broken toward the prediction (smaller motion). */
function searchBlock(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  predictDx: number,
  predictDy: number,
  radius: number,
): { dx: number; dy: number } {
  let bestDx = predictDx;
  let bestDy = predictDy;
  let bestSad = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cdx = predictDx + dx;
      const cdy = predictDy + dy;
      const sad = blockSad(a, b, width, height, x0, y0, x1, y1, cdx, cdy);
      const better =
        sad < bestSad - 1e-6 ||
        (Math.abs(sad - bestSad) < 1e-6 &&
          (cdx - predictDx) ** 2 + (cdy - predictDy) ** 2 <
            (bestDx - predictDx) ** 2 + (bestDy - predictDy) ** 2);
      if (better) {
        bestSad = sad;
        bestDx = cdx;
        bestDy = cdy;
      }
    }
  }
  return { dx: bestDx, dy: bestDy };
}

/** Parabolic sub-pixel offset from three SAD samples s(-1), s(0), s(+1) with
 *  s(0) the integer minimum. Returns a fraction in [-0.5, 0.5]; 0 when the
 *  neighbourhood is flat (denom ≈ 0) OR the residual is already zero (a perfect
 *  integer match — the SAD surface is V-shaped there, not quadratic, so the
 *  parabola would overshoot; the exact integer vector needs no sub-pixel nudge). */
function parabolicOffset(sm1: number, s0: number, sp1: number): number {
  if (s0 <= 1e-9) return 0;
  const denom = sm1 - 2 * s0 + sp1;
  if (Math.abs(denom) < 1e-9) return 0;
  const off = (0.5 * (sm1 - sp1)) / denom;
  return off < -0.5 ? -0.5 : off > 0.5 ? 0.5 : off;
}

/**
 * Estimate an A→B block motion field, coarse-to-fine with sub-pixel refinement.
 * Cheap relative to a full denoise; deterministic.
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
  const levels = Math.max(1, Math.floor(opts.levels ?? 3));
  const la = luma(a, width, height);
  const lb = luma(b, width, height);
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  const vec = new Float32Array(cols * rows * 2);

  // Coarse stage: full search on a downscaled plane to capture large motion.
  const factor = 2 ** (levels - 1);
  const coarseA = downscale(la, width, height, factor);
  const coarseB = downscale(lb, width, height, factor);

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * blockSize;
      const y0 = by * blockSize;
      const x1 = Math.min(x0 + blockSize, width);
      const y1 = Math.min(y0 + blockSize, height);

      // 1) Coarse prediction (skip when single-level).
      let predictDx = 0;
      let predictDy = 0;
      if (factor > 1) {
        const cx0 = Math.floor(x0 / factor);
        const cy0 = Math.floor(y0 / factor);
        const cx1 = Math.max(cx0 + 1, Math.floor(x1 / factor));
        const cy1 = Math.max(cy0 + 1, Math.floor(y1 / factor));
        const coarse = searchBlock(
          coarseA.data, coarseB.data, coarseA.width, coarseA.height,
          cx0, cy0, cx1, cy1, 0, 0, searchRadius,
        );
        predictDx = coarse.dx * factor;
        predictDy = coarse.dy * factor;
      } else {
        // Single-level: the full search happens here at full res.
        const full = searchBlock(la, lb, width, height, x0, y0, x1, y1, 0, 0, searchRadius);
        predictDx = full.dx;
        predictDy = full.dy;
      }

      // 2) Full-res integer refine around the prediction.
      const fine = searchBlock(la, lb, width, height, x0, y0, x1, y1, predictDx, predictDy, FINE_RADIUS);

      // 3) Sub-pixel parabolic refinement on the full-res SAD surface.
      const s0 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx, fine.dy);
      const sxm1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx - 1, fine.dy);
      const sxp1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx + 1, fine.dy);
      const sym1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx, fine.dy - 1);
      const syp1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx, fine.dy + 1);

      const bi = (by * cols + bx) * 2;
      vec[bi] = fine.dx + parabolicOffset(sxm1, s0, sxp1);
      vec[bi + 1] = fine.dy + parabolicOffset(sym1, s0, syp1);
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
  const x0 = clampInt(Math.floor(fx), 0, width - 1);
  const x1 = clampInt(x0 + 1, 0, width - 1);
  const y0 = clampInt(Math.floor(fy), 0, height - 1);
  const y1 = clampInt(y0 + 1, 0, height - 1);
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
 * in between, the subject is sampled from where it physically was at time t, so
 * it slides rather than fades.
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

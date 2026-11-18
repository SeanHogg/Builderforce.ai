import { GRID_INDEX, MAIN, MAX_RANK, type KernelEntry } from "./common";

/**
 * Layout and reduction kernels.
 *
 * `strided_copy` materializes any strided view (transpose, permute, broadcast
 * expand with stride 0). It moves raw 32-bit words, so it serves float32 and
 * int32 alike. Parameter block: [n, rank, offset, shape[8], strides[8]].
 *
 * `sum` reduces any set of axes. The output is walked in "kept" coordinates and
 * each invocation loops over the reduced sub-space. Parameter block:
 * [outN, keptRank, redRank, redCount, keptShape[8], keptStrides[8],
 *  redShape[8], redStrides[8]] (strides are the input's contiguous strides).
 */

const COPY_SHAPE = 3;
const COPY_STRIDES = COPY_SHAPE + MAX_RANK;
export const COPY_PARAMS = COPY_STRIDES + MAX_RANK;
export const COPY_LAYOUT = { shape: COPY_SHAPE, strides: COPY_STRIDES } as const;

const KEPT_SHAPE = 4;
const KEPT_STRIDES = KEPT_SHAPE + MAX_RANK;
const RED_SHAPE = KEPT_STRIDES + MAX_RANK;
const RED_STRIDES = RED_SHAPE + MAX_RANK;
export const SUM_PARAMS = RED_STRIDES + MAX_RANK;
export const SUM_LAYOUT = {
  keptShape: KEPT_SHAPE,
  keptStrides: KEPT_STRIDES,
  redShape: RED_SHAPE,
  redStrides: RED_STRIDES,
} as const;

export const LAYOUT_KERNELS = {
  strided_copy: {
    bindings: 3,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> a: array<u32>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  if (idx >= p[0]) { return; }
  var rem = idx;
  var src = p[2];
  for (var d = i32(p[1]) - 1; d >= 0; d = d - 1) {
    let k = u32(d);
    let dim = p[${COPY_SHAPE}u + k];
    src = src + (rem % dim) * p[${COPY_STRIDES}u + k];
    rem = rem / dim;
  }
  out[idx] = a[src];
}`,
  },
  sum: {
    bindings: 3,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  if (idx >= p[0]) { return; }
  var rem = idx;
  var base = 0u;
  for (var d = i32(p[1]) - 1; d >= 0; d = d - 1) {
    let k = u32(d);
    let dim = p[${KEPT_SHAPE}u + k];
    base = base + (rem % dim) * p[${KEPT_STRIDES}u + k];
    rem = rem / dim;
  }
  var acc = 0.0;
  for (var r = 0u; r < p[3]; r = r + 1u) {
    var rr = r;
    var off = base;
    for (var d = i32(p[2]) - 1; d >= 0; d = d - 1) {
      let k = u32(d);
      let dim = p[${RED_SHAPE}u + k];
      off = off + (rr % dim) * p[${RED_STRIDES}u + k];
      rr = rr / dim;
    }
    acc = acc + a[off];
  }
  out[idx] = acc;
}`,
  },
} satisfies Record<string, KernelEntry>;

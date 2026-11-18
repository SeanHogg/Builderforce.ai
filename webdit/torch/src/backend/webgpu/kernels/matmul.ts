import { GRID_INDEX, MAIN, type KernelEntry } from "./common";

/**
 * Batched matmul, one invocation per output element. Transposition is carried
 * entirely by strides, so `a @ bᵀ` (Linear) and `aᵀ @ g` (its weight gradient)
 * need no materialized transpose.
 *
 * Parameter block: [M, N, K, batch, aBatchStride, bBatchStride,
 *                   aRowStride, aKStride, bKStride, bColStride]
 * A 2D operand broadcast across the batch carries batch stride 0.
 */
export const MATMUL_KERNELS = {
  matmul: {
    bindings: 4,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  let M = p[0]; let N = p[1]; let K = p[2];
  if (idx >= p[3] * M * N) { return; }
  let n = idx % N;
  let m = (idx / N) % M;
  let bt = idx / (M * N);
  let aBase = bt * p[4] + m * p[6];
  let bBase = bt * p[5] + n * p[9];
  var acc = 0.0;
  for (var k = 0u; k < K; k = k + 1u) {
    acc = acc + a[aBase + k * p[7]] * b[bBase + k * p[8]];
  }
  out[idx] = acc;
}`,
  },
} satisfies Record<string, KernelEntry>;

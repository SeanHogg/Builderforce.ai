import { GRID_INDEX, MAIN, type KernelEntry } from "./common";

/**
 * Embedding lookup and its gradient.
 *
 * embedding        [n, dim, vocab]   one invocation per output element; an
 *                                    out-of-range id reads as zeros. Ids the
 *                                    host knows are range-checked before
 *                                    dispatch (`autograd/index-check.ts`).
 *
 * The gradient scatters gy rows into their vocab rows. Two kernels, both
 * O(N·dim) in total work (the old gather over every id per weight element was
 * O(vocab·dim·N)):
 *
 * embedding_backward_csr     [vocab, dim]     ids known on the host: the backend
 *                            builds a CSR of positions per vocab row (rowStart,
 *                            positions) and each invocation (row, d) sums only
 *                            its own row's positions. Deterministic.
 * embedding_backward_atomic  [n, dim, vocab]  device-resident ids: one invocation
 *                            per (position, d) adds into a zeroed output with a
 *                            compare-exchange loop on the f32's bits (WGSL has no
 *                            float atomics). Summation order is not fixed.
 * Out-of-range ids contribute nothing in either.
 */
export const EMBEDDING_KERNELS = {
  embedding: {
    bindings: 4,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> weight: array<f32>;
@group(0) @binding(1) var<storage, read> ids: array<i32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  let dim = p[1];
  if (idx >= p[0]) { return; }
  let id = ids[idx / dim];
  if (id < 0 || u32(id) >= p[2]) { out[idx] = 0.0; return; }
  out[idx] = weight[u32(id) * dim + idx % dim];
}`,
  },
  embedding_backward_csr: {
    bindings: 5,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> rowStart: array<u32>;
@group(0) @binding(1) var<storage, read> positions: array<u32>;
@group(0) @binding(2) var<storage, read> gy: array<f32>;
@group(0) @binding(3) var<storage, read_write> out: array<f32>;
@group(0) @binding(4) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  let dim = p[1];
  if (idx >= p[0] * dim) { return; }
  let row = idx / dim;
  let d = idx % dim;
  var acc = 0.0;
  for (var k = rowStart[row]; k < rowStart[row + 1u]; k = k + 1u) {
    acc = acc + gy[positions[k] * dim + d];
  }
  out[idx] = acc;
}`,
  },
  embedding_backward_atomic: {
    bindings: 4,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> ids: array<i32>;
@group(0) @binding(1) var<storage, read> gy: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  let dim = p[1];
  if (idx >= p[0] * dim) { return; }
  let id = ids[idx / dim];
  if (id < 0 || u32(id) >= p[2]) { return; }
  let slot = u32(id) * dim + idx % dim;
  let add = gy[idx];
  var old = atomicLoad(&out[slot]);
  loop {
    let swapped = atomicCompareExchangeWeak(&out[slot], old, bitcast<u32>(bitcast<f32>(old) + add));
    if (swapped.exchanged) { break; }
    old = swapped.old_value;
  }
}`,
  },
} satisfies Record<string, KernelEntry>;

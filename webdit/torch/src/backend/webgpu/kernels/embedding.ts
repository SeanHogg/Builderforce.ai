import { GRID_INDEX, MAIN, type KernelEntry } from "./common";

/**
 * Embedding lookup and its gradient.
 *
 * embedding           [n, dim, vocab]   one invocation per output element; an
 *                                       out-of-range id reads as zeros (the
 *                                       CPU reference throws — a GPU cannot).
 * embedding_backward  [vocab, dim, ids] one invocation per weight element; it
 *                                       gathers every occurrence of its row, so
 *                                       repeated ids sum without float atomics.
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
  embedding_backward: {
    bindings: 4,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> ids: array<i32>;
@group(0) @binding(1) var<storage, read> gy: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  let dim = p[1];
  if (idx >= p[0] * dim) { return; }
  let row = i32(idx / dim);
  let d = idx % dim;
  var acc = 0.0;
  for (var n = 0u; n < p[2]; n = n + 1u) {
    if (ids[n] == row) { acc = acc + gy[n * dim + d]; }
  }
  out[idx] = acc;
}`,
  },
} satisfies Record<string, KernelEntry>;

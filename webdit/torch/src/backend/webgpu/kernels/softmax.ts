import { GRID_INDEX, MAIN, type KernelEntry } from "./common";

/**
 * Last-dim softmax family and fused cross-entropy. One invocation per row;
 * parameter block [rows, cols]. Same loops as `cpu/row-kernels.ts`.
 */

const ROW_HEAD = `
  ${GRID_INDEX}
  let rows = p[0];
  let cols = p[1];
  if (idx >= rows) { return; }
  let base = idx * cols;`;

const ROW_MAX = `
  var m = -3.4e38;
  for (var c = 0u; c < cols; c = c + 1u) { m = max(m, a[base + c]); }
  var s = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { s = s + exp(a[base + c] - m); }`;

const forwardRow = (body: string): KernelEntry => ({
  bindings: 3,
  dispatch: "grid",
  wgsl: `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${MAIN} {${ROW_HEAD}${ROW_MAX}
  for (var c = 0u; c < cols; c = c + 1u) { ${body} }
}`,
});

const backwardRow = (reduce: string, body: string): KernelEntry => ({
  bindings: 4,
  dispatch: "grid",
  wgsl: `
@group(0) @binding(0) var<storage, read> y: array<f32>;
@group(0) @binding(1) var<storage, read> g: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${MAIN} {${ROW_HEAD}
  var s = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { s = s + ${reduce}; }
  for (var c = 0u; c < cols; c = c + 1u) { out[base + c] = ${body}; }
}`,
});

export const SOFTMAX_KERNELS = {
  softmax: forwardRow("out[base + c] = exp(a[base + c] - m) / s;"),
  log_softmax: forwardRow("out[base + c] = a[base + c] - (m + log(s));"),
  softmax_backward: backwardRow("g[base + c] * y[base + c]", "y[base + c] * (g[base + c] - s)"),
  log_softmax_backward: backwardRow("g[base + c]", "g[base + c] - exp(y[base + c]) * s"),
  cross_entropy: {
    bindings: 5,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> targets: array<i32>;
@group(0) @binding(2) var<storage, read_write> loss: array<f32>;
@group(0) @binding(3) var<storage, read_write> probs: array<f32>;
@group(0) @binding(4) var<storage, read> p: array<u32>;
${MAIN} {${ROW_HEAD}${ROW_MAX}
  for (var c = 0u; c < cols; c = c + 1u) { probs[base + c] = exp(a[base + c] - m) / s; }
  let t = u32(clamp(targets[idx], 0, i32(cols) - 1));
  loss[idx] = m + log(s) - a[base + t];
}`,
  },
  cross_entropy_backward: {
    bindings: 5,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> probs: array<f32>;
@group(0) @binding(1) var<storage, read> targets: array<i32>;
@group(0) @binding(2) var<storage, read> gloss: array<f32>;
@group(0) @binding(3) var<storage, read_write> out: array<f32>;
@group(0) @binding(4) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  let cols = p[1];
  if (idx >= p[0] * cols) { return; }
  let row = idx / cols;
  let c = idx % cols;
  let onehot = select(0.0, 1.0, i32(c) == targets[row]);
  out[idx] = (probs[idx] - onehot) * gloss[row];
}`,
  },
} satisfies Record<string, KernelEntry>;

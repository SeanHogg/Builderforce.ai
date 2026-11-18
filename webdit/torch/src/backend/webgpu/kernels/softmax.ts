import { GRID_INDEX, MAIN, type KernelEntry } from "./common";

/**
 * Last-dim softmax family and fused cross-entropy. One invocation per row;
 * parameter block [rows, cols] (cross-entropy adds ignoreIndex as i32 bits).
 * Same loops as `cpu/row-kernels.ts`.
 *
 * Cross-entropy targets: a row whose target equals `ignoreIndex` gives 0 loss,
 * 0 gradient and `valid = 0`. Any other out-of-range target is clamped into
 * [0, C) — identically in forward and backward — because a device-resident
 * index cannot throw (host-known targets are range-checked before dispatch).
 */

/** The clamped class of a row's target. */
const TARGET_FN = "fn target_of(row: u32, cols: u32) -> u32 { return u32(clamp(targets[row], 0, i32(cols) - 1)); }";

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
    bindings: 6,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> targets: array<i32>;
@group(0) @binding(2) var<storage, read_write> loss: array<f32>;
@group(0) @binding(3) var<storage, read_write> probs: array<f32>;
@group(0) @binding(4) var<storage, read_write> valid: array<f32>;
@group(0) @binding(5) var<storage, read> p: array<u32>;
${TARGET_FN}
${MAIN} {${ROW_HEAD}${ROW_MAX}
  for (var c = 0u; c < cols; c = c + 1u) { probs[base + c] = exp(a[base + c] - m) / s; }
  if (targets[idx] == bitcast<i32>(p[2])) { loss[idx] = 0.0; valid[idx] = 0.0; return; }
  loss[idx] = m + log(s) - a[base + target_of(idx, cols)];
  valid[idx] = 1.0;
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
${TARGET_FN}
${MAIN} {
  ${GRID_INDEX}
  let cols = p[1];
  if (idx >= p[0] * cols) { return; }
  let row = idx / cols;
  let c = idx % cols;
  if (targets[row] == bitcast<i32>(p[2])) { out[idx] = 0.0; return; }
  let onehot = select(0.0, 1.0, c == target_of(row, cols));
  out[idx] = (probs[idx] - onehot) * gloss[row];
}`,
  },
} satisfies Record<string, KernelEntry>;

import { GRID_INDEX, MAIN, PARAM_FLOAT, type KernelEntry } from "./common";

/**
 * LayerNorm over the last dim. Absent gamma/beta are bound to a 1-word dummy
 * and switched off by flags, so one pipeline serves every affine combination.
 *
 * layer_norm            [rows, cols, epsBits, hasGamma, hasBeta]  one invocation per row
 * layer_norm_backward   [rows, cols, hasGamma]                    one invocation per row (gx)
 * layer_norm_affine_backward [rows, cols]                         one invocation per column (gGamma, gBeta)
 */
export const LAYERNORM_KERNELS = {
  layer_norm: {
    bindings: 7,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> gamma: array<f32>;
@group(0) @binding(2) var<storage, read> beta: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<storage, read_write> mean: array<f32>;
@group(0) @binding(5) var<storage, read_write> rstd: array<f32>;
@group(0) @binding(6) var<storage, read> p: array<u32>;
${PARAM_FLOAT}
${MAIN} {
  ${GRID_INDEX}
  let rows = p[0]; let cols = p[1];
  if (idx >= rows) { return; }
  let base = idx * cols;
  var mu = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { mu = mu + x[base + c]; }
  mu = mu / f32(cols);
  var vr = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { let d = x[base + c] - mu; vr = vr + d * d; }
  vr = vr / f32(cols);
  let inv = 1.0 / sqrt(vr + pf(2u));
  mean[idx] = mu;
  rstd[idx] = inv;
  for (var c = 0u; c < cols; c = c + 1u) {
    var v = (x[base + c] - mu) * inv;
    if (p[3] != 0u) { v = v * gamma[c]; }
    if (p[4] != 0u) { v = v + beta[c]; }
    y[base + c] = v;
  }
}`,
  },
  layer_norm_backward: {
    bindings: 7,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> gamma: array<f32>;
@group(0) @binding(2) var<storage, read> mean: array<f32>;
@group(0) @binding(3) var<storage, read> rstd: array<f32>;
@group(0) @binding(4) var<storage, read> gy: array<f32>;
@group(0) @binding(5) var<storage, read_write> gx: array<f32>;
@group(0) @binding(6) var<storage, read> p: array<u32>;
fn gh(i: u32, c: u32) -> f32 { return gy[i] * select(1.0, gamma[c], p[2] != 0u); }
${MAIN} {
  ${GRID_INDEX}
  let rows = p[0]; let cols = p[1];
  if (idx >= rows) { return; }
  let base = idx * cols;
  let mu = mean[idx];
  let r = rstd[idx];
  var sg = 0.0;
  var sgx = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) {
    let g = gh(base + c, c);
    sg = sg + g;
    sgx = sgx + g * (x[base + c] - mu) * r;
  }
  let n = f32(cols);
  for (var c = 0u; c < cols; c = c + 1u) {
    let xh = (x[base + c] - mu) * r;
    gx[base + c] = (r / n) * (n * gh(base + c, c) - sg - xh * sgx);
  }
}`,
  },
  layer_norm_affine_backward: {
    bindings: 7,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> mean: array<f32>;
@group(0) @binding(2) var<storage, read> rstd: array<f32>;
@group(0) @binding(3) var<storage, read> gy: array<f32>;
@group(0) @binding(4) var<storage, read_write> ggamma: array<f32>;
@group(0) @binding(5) var<storage, read_write> gbeta: array<f32>;
@group(0) @binding(6) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  let rows = p[0]; let cols = p[1];
  if (idx >= cols) { return; }
  var sg = 0.0;
  var sb = 0.0;
  for (var r = 0u; r < rows; r = r + 1u) {
    let g = gy[r * cols + idx];
    sg = sg + g * (x[r * cols + idx] - mean[r]) * rstd[r];
    sb = sb + g;
  }
  ggamma[idx] = sg;
  gbeta[idx] = sb;
}`,
  },
} satisfies Record<string, KernelEntry>;

import { GELU_FNS, GRID_INDEX, MAIN, MAX_RANK, PARAM_FLOAT, type KernelEntry } from "./common";

/**
 * Elementwise kernels: unary maps, the affine map, and broadcasting binaries.
 *
 * Unary parameter block: [n, scaleBits, shiftBits].
 * Binary parameter block: [n, rank, outShape[8], aStrides[8], bStrides[8]] —
 * a broadcast operand carries stride 0 on the broadcast dims.
 */

function unary(expr: string, prelude = ""): KernelEntry {
  return {
    bindings: 3,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${PARAM_FLOAT}
${prelude}
${MAIN} {
  ${GRID_INDEX}
  if (idx >= p[0]) { return; }
  let x = a[idx];
  out[idx] = ${expr};
}`,
  };
}

const SHAPE = 2;
const A_STRIDES = SHAPE + MAX_RANK;
const B_STRIDES = A_STRIDES + MAX_RANK;
/** Length of the binary parameter block. */
export const BINARY_PARAMS = B_STRIDES + MAX_RANK;
export const BINARY_LAYOUT = { shape: SHAPE, aStrides: A_STRIDES, bStrides: B_STRIDES } as const;

function binary(expr: string, prelude = ""): KernelEntry {
  return {
    bindings: 4,
    dispatch: "grid",
    wgsl: `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${prelude}
${MAIN} {
  ${GRID_INDEX}
  if (idx >= p[0]) { return; }
  var rem = idx;
  var ai = 0u;
  var bi = 0u;
  for (var d = i32(p[1]) - 1; d >= 0; d = d - 1) {
    let k = u32(d);
    let dim = p[${SHAPE}u + k];
    let c = rem % dim;
    rem = rem / dim;
    ai = ai + c * p[${A_STRIDES}u + k];
    bi = bi + c * p[${B_STRIDES}u + k];
  }
  let x = a[ai];
  let y = b[bi];
  out[idx] = ${expr};
}`,
  };
}

export const ELEMENTWISE_KERNELS = {
  relu: unary("max(x, 0.0)"),
  gelu: unary("gelu_f(x)", GELU_FNS),
  exp: unary("exp(x)"),
  log: unary("log(x)"),
  affine: unary("x * pf(1u) + pf(2u)"),
  add: binary("x + y"),
  sub: binary("x - y"),
  mul: binary("x * y"),
  div: binary("x / y"),
  relu_backward: binary("select(0.0, y, x > 0.0)"),
  gelu_backward: binary("y * gelu_d(x)", GELU_FNS),
} satisfies Record<string, KernelEntry>;

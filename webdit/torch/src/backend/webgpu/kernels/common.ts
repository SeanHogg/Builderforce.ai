/**
 * Shared WGSL fragments and the one kernel-entry shape the registry holds.
 *
 * Conventions every engine kernel keeps (the ported trainer kernels keep their
 * own original layout, documented in `lora.ts` / `optim.ts`):
 *  - entry point `main`, workgroup size 256;
 *  - bindings are storage buffers in the order the backend passes them, with
 *    the parameter block LAST as `p: array<u32>` (floats travel bit-cast);
 *  - every kernel spills past 65 535 workgroups into `gid.y`, and recovers its
 *    flat index with `GRID_INDEX` (the ported trainer kernels spell it inline).
 */

export interface KernelEntry {
  /** WGSL source; the entry point is always `main`. */
  readonly wgsl: string;
  /** Storage bindings in order, parameter block included. */
  readonly bindings: number;
  /** One invocation per thread, dispatched over x then spilled into y (65 535 cap per dim). */
  readonly dispatch: "grid";
  /** Device feature the shader needs; absent = core WebGPU. */
  readonly requires?: "shader-f16";
}

export const WORKGROUP_SIZE = 256;
/** Max broadcast/strided rank the index-walking kernels carry in their parameter block. */
export const MAX_RANK = 8;

export const GRID_INDEX = "let idx = gid.x + gid.y * 65535u * 256u;";

export const MAIN = "@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>)";

/** `f(p[i])` reads a bit-cast float from the parameter block. */
export const PARAM_FLOAT = "fn pf(i: u32) -> f32 { return bitcast<f32>(p[i]); }";

/** Tanh-approximated GELU and its derivative — the same formula as `ops/activation.gelu`. */
export const GELU_FNS = `
const GELU_C: f32 = 0.7978845608028654;
fn gelu_t(x: f32) -> f32 { return tanh(clamp(GELU_C * (x + 0.044715 * x * x * x), -15.0, 15.0)); }
fn gelu_f(x: f32) -> f32 { return 0.5 * x * (1.0 + gelu_t(x)); }
fn gelu_d(x: f32) -> f32 {
  let t = gelu_t(x);
  return 0.5 * (1.0 + t) + 0.5 * x * (1.0 - t * t) * GELU_C * (1.0 + 3.0 * 0.044715 * x * x);
}`;

import type { KernelEntry } from "./common";

/**
 * Optimizer kernels.
 *
 * ADAMW_WGSL moved here from the frontend's old main-thread trainer; the browser
 * trainer now reaches it through `optim.AdamW` (`frontend/src/lib/training/**`).
 * It keeps that trainer's 16-float parameter block, whose AdamW slots are:
 *
 *   p[4] lr  p[5] beta1  p[6] beta2  p[7] eps  p[8] weightDecay
 *   p[9] gradScale (1 / accumulated micro-batches)  p[10] step (1-based)
 *   p[11] keepGrad — 0: zero `g` after reading it (the trainer's contract; it
 *         never writes this slot, so it stays 0); 1: leave `g` intact (the
 *         engine's PyTorch semantics, where `zeroGrad()` clears it).
 *
 * bindings (w, g, m, v, p). The element count is `arrayLength(&w)`, so `w` must
 * be bound at its exact size.
 *
 * Changes from the trainer's original text (both backward-compatible with its
 * 1-D dispatch of ceil(|w| / 256) workgroups, where gid.y is 0):
 *  - the index spills into gid.y (`gid.x + gid.y·65535·256`), so the engine can
 *    dispatch more than 65 535 workgroups (> 16 776 960 elements);
 *  - the gradient reset is gated on p[11].
 *
 * SGD_WGSL — bindings (w, g, buf, p), p: array<f32> = [lr, momentum,
 * weightDecay, hasMomentumBuffer]; `buf` is a 1-word dummy when momentum is off.
 */

export const ADAMW_WGSL = `
@group(0) @binding(0) var<storage,read_write> w: array<f32>;
@group(0) @binding(1) var<storage,read_write> g: array<f32>;
@group(0) @binding(2) var<storage,read_write> m: array<f32>;
@group(0) @binding(3) var<storage,read_write> v: array<f32>;
@group(0) @binding(4) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i=gid.x+gid.y*65535u*256u;if(i>=arrayLength(&w)){return;}let grad=g[i]*p[9];let b1=p[5];let b2=p[6];
  m[i]=b1*m[i]+(1.0-b1)*grad;v[i]=b2*v[i]+(1.0-b2)*grad*grad;
  let mh=m[i]/(1.0-pow(b1,p[10]));let vh=v[i]/(1.0-pow(b2,p[10]));
  w[i]=w[i]-p[4]*(mh/(sqrt(vh)+p[7])+p[8]*w[i]);if(p[11]==0.0){g[i]=0.0;}
}`;

export const SGD_WGSL = `
@group(0) @binding(0) var<storage,read_write> w: array<f32>;
@group(0) @binding(1) var<storage,read> g: array<f32>;
@group(0) @binding(2) var<storage,read_write> buf: array<f32>;
@group(0) @binding(3) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i=gid.x+gid.y*65535u*256u;if(i>=arrayLength(&w)){return;}
  var d=g[i]+p[2]*w[i];
  if(p[3]!=0.0){buf[i]=p[1]*buf[i]+d;d=buf[i];}
  w[i]=w[i]-p[0]*d;
}`;

/** Length of the shared trainer parameter block (`p` of the LoRA and AdamW kernels). */
export const TRAINER_PARAM_FLOATS = 16;

export const OPTIM_KERNELS = {
  adamw: { wgsl: ADAMW_WGSL, bindings: 5, dispatch: "grid" },
  sgd: { wgsl: SGD_WGSL, bindings: 4, dispatch: "grid" },
} satisfies Record<string, KernelEntry>;

import type { KernelEntry } from "./common";

/**
 * LoRA adapter kernels, moved here from the frontend's browser trainer
 * (`frontend/src/lib/webgpu-trainer.ts`) so the engine and the trainer run one
 * copy (the trainer imports them from here). Consumers that drive them directly keep the
 * original parameter layout:
 *
 *   p: array<f32> = [rows, cols, rank, scale, …]
 *   A: [rank, cols]   B: [rows, rank]   base / merged / gw: [rows, cols]
 *
 * LORA_FORWARD_WGSL   bindings (base, a, b, merged, p)   merged = base + scale·(B A)
 *                     2D dispatch: [min(g, 65535), ceil(g / 65535), 1], g = ceil(rows·cols / 256)
 * LORA_BACKWARD_WGSL  bindings (gw, a, b, ga, gb, p)     ga += scale·Bᵀ gw ; gb += scale·gw Aᵀ
 *                     dispatch: ceil(max(|A|, |B|) / 256) workgroups, 1-D (the trainer) or
 *                     spilled into y. Change from the trainer's original text: the index is
 *                     `gid.x + gid.y·65535·256` (was `gid.x`) — identical under a 1-D dispatch.
 */

export const LORA_FORWARD_WGSL = `
@group(0) @binding(0) var<storage,read> base: array<f32>;
@group(0) @binding(1) var<storage,read> a: array<f32>;
@group(0) @binding(2) var<storage,read> b: array<f32>;
@group(0) @binding(3) var<storage,read_write> merged: array<f32>;
@group(0) @binding(4) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let rows=u32(p[0]); let cols=u32(p[1]); let rank=u32(p[2]); let idx=gid.x+gid.y*65535u*256u;
  if(idx>=rows*cols){return;} let row=idx/cols; let col=idx%cols; var delta=0.0;
  for(var k=0u;k<rank;k=k+1u){delta=delta+b[row*rank+k]*a[k*cols+col];}
  merged[idx]=base[idx]+p[3]*delta;
}`;

export const LORA_BACKWARD_WGSL = `
@group(0) @binding(0) var<storage,read> gw: array<f32>;
@group(0) @binding(1) var<storage,read> a: array<f32>;
@group(0) @binding(2) var<storage,read> b: array<f32>;
@group(0) @binding(3) var<storage,read_write> ga: array<f32>;
@group(0) @binding(4) var<storage,read_write> gb: array<f32>;
@group(0) @binding(5) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let rows=u32(p[0]); let cols=u32(p[1]); let rank=u32(p[2]); let idx=gid.x+gid.y*65535u*256u; let scale=p[3];
  if(idx<rank*cols){let k=idx/cols;let col=idx%cols;var sum=0.0;for(var row=0u;row<rows;row=row+1u){sum=sum+b[row*rank+k]*gw[row*cols+col];}ga[idx]=ga[idx]+scale*sum;}
  if(idx<rows*rank){let row=idx/rank;let k=idx%rank;var sum=0.0;for(var col=0u;col<cols;col=col+1u){sum=sum+gw[row*cols+col]*a[k*cols+col];}gb[idx]=gb[idx]+scale*sum;}
}`;

export const LORA_KERNELS = {
  lora_forward: { wgsl: LORA_FORWARD_WGSL, bindings: 5, dispatch: "grid" },
  lora_backward: { wgsl: LORA_BACKWARD_WGSL, bindings: 6, dispatch: "grid" },
} satisfies Record<string, KernelEntry>;

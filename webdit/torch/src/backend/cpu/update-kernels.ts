import { Tensor } from "../../tensor";
import type { AdamWStep, SgdStep } from "../backend";
import { f32 } from "./row-kernels";

/**
 * CPU reference for the in-place update kernels: AdamW, SGD and the LoRA
 * merge / chain-rule backward. Each is the line-for-line mirror of its WGSL
 * entry (`ADAMW_WGSL`, `SGD_WGSL`, `LORA_FORWARD_WGSL`, `LORA_BACKWARD_WGSL`,
 * `add_inplace`), including AdamW zeroing the gradient unless `keepGrad`.
 */

/** In-place handles must already be contiguous, or the write would land in a copy. */
function own(t: Tensor, op: string): Float32Array {
  if (!t.isContiguous() || t.dtype !== "float32") throw new Error(`${op}: in-place target must be a contiguous float32 tensor`);
  return t.data as Float32Array;
}

export function adamwStep(param: Tensor, grad: Tensor, m: Tensor, v: Tensor, s: AdamWStep): void {
  const w = own(param, "adamw");
  const g = own(grad, "adamw");
  const M = own(m, "adamw");
  const V = own(v, "adamw");
  const c1 = 1 - Math.pow(s.beta1, s.step);
  const c2 = 1 - Math.pow(s.beta2, s.step);
  for (let i = 0; i < w.length; i++) {
    const gr = g[i]! * s.gradScale;
    M[i] = s.beta1 * M[i]! + (1 - s.beta1) * gr;
    V[i] = s.beta2 * V[i]! + (1 - s.beta2) * gr * gr;
    const mh = M[i]! / c1;
    const vh = V[i]! / c2;
    w[i] = w[i]! - s.lr * (mh / (Math.sqrt(vh) + s.eps) + s.weightDecay * w[i]!);
    if (!s.keepGrad) g[i] = 0;
  }
}

export function addInPlace(target: Tensor, src: Tensor): void {
  const t = own(target, "add_inplace");
  const s = f32(src);
  if (s.length !== t.length) throw new Error(`add_inplace: ${s.length} values into ${t.length}`);
  for (let i = 0; i < t.length; i++) t[i]! += s[i]!;
}

/** target ← src, bit-exact; a no-op on shared storage. */
export function copyInPlace(target: Tensor, src: Tensor): void {
  if (target.dtype !== src.dtype) throw new Error(`copy_inplace: ${src.dtype} into ${target.dtype}`);
  if (!target.isContiguous() || target.data.length !== target.size) throw new Error("copy_inplace: target must be a contiguous tensor");
  const s = src.contiguous();
  if (s.size !== target.size) throw new Error(`copy_inplace: ${s.size} values into ${target.size}`);
  if (s.data === target.data) return;
  (target.data as Float32Array | Int32Array).set(s.data as Float32Array | Int32Array);
}

/** float32 ⇄ int32; float → int truncates toward zero. */
export function cast(a: Tensor, dtype: "float32" | "int32"): Tensor {
  const c = a.contiguous();
  if (c.dtype === dtype) return Tensor.contiguous(c.data.slice() as Float32Array | Int32Array, c.shape, dtype);
  const data = dtype === "int32" ? Int32Array.from(c.data as Float32Array, (v) => Math.trunc(v)) : Float32Array.from(c.data as Int32Array);
  return Tensor.contiguous(data, c.shape, dtype);
}

export function sgdStep(param: Tensor, grad: Tensor, buf: Tensor | null, s: SgdStep): void {
  const w = own(param, "sgd");
  const g = f32(grad);
  const B = buf ? own(buf, "sgd") : null;
  for (let i = 0; i < w.length; i++) {
    let d = g[i]! + s.weightDecay * w[i]!;
    if (B) {
      B[i] = s.momentum * B[i]! + d;
      d = B[i]!;
    }
    w[i] = w[i]! - s.lr * d;
  }
}

function loraDims(base: Tensor, a: Tensor, b: Tensor): { rows: number; cols: number; rank: number } {
  const rows = base.shape[0]!;
  const cols = base.shape[1]!;
  const rank = a.shape[0]!;
  if (base.shape.length !== 2 || a.shape[1] !== cols || b.shape[0] !== rows || b.shape[1] !== rank) {
    throw new Error(
      `lora: base ${JSON.stringify(base.shape)}, A ${JSON.stringify(a.shape)}, B ${JSON.stringify(b.shape)} must be [rows, cols], [rank, cols], [rows, rank]`,
    );
  }
  return { rows, cols, rank };
}

export function loraMerge(base: Tensor, a: Tensor, b: Tensor, scale: number): Tensor {
  const { rows, cols, rank } = loraDims(base, a, b);
  const W = f32(base);
  const A = f32(a);
  const B = f32(b);
  const out = new Float32Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let delta = 0;
      for (let k = 0; k < rank; k++) delta += B[row * rank + k]! * A[k * cols + col]!;
      out[row * cols + col] = W[row * cols + col]! + scale * delta;
    }
  }
  return Tensor.contiguous(out, [rows, cols], "float32");
}

export function loraBackward(gw: Tensor, a: Tensor, b: Tensor, scale: number, ga: Tensor, gb: Tensor): void {
  const { rows, cols, rank } = loraDims(gw, a, b);
  const G = f32(gw);
  const A = f32(a);
  const B = f32(b);
  const GA = own(ga, "lora_backward");
  const GB = own(gb, "lora_backward");
  for (let k = 0; k < rank; k++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0;
      for (let row = 0; row < rows; row++) sum += B[row * rank + k]! * G[row * cols + col]!;
      GA[k * cols + col]! += scale * sum;
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let k = 0; k < rank; k++) {
      let sum = 0;
      for (let col = 0; col < cols; col++) sum += G[row * cols + col]! * A[k * cols + col]!;
      GB[row * rank + k]! += scale * sum;
    }
  }
}

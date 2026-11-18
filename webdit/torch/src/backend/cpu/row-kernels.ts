import { normalizeOne } from "../../nn/layer-norm";
import { Tensor } from "../../tensor";
import type { CrossEntropyForward, LayerNormBackward, LayerNormForward } from "../backend";
import { rowsOf, sameShape } from "../shape-rules";

/**
 * CPU reference kernels for the row-wise ops (last-dim softmax family,
 * layernorm, cross-entropy, embedding backward). Each mirrors one WGSL kernel
 * in `../webgpu/kernels`, loop for loop, so the parity tests compare the same
 * arithmetic.
 */

export const f32 = (t: Tensor): Float32Array => t.contiguous().data as Float32Array;

export function readIds(t: Tensor): Int32Array {
  const c = t.contiguous();
  if (c.dtype === "int32") return c.data as Int32Array;
  if (c.dtype === "int64") return Int32Array.from(c.data as BigInt64Array, (v) => Number(v));
  throw new Error(`expected an int32 index tensor, got ${c.dtype}`);
}

const dense = (data: Float32Array, shape: readonly number[]) => Tensor.contiguous(data, shape, "float32");

export function softmaxBackward(y: Tensor, gy: Tensor): Tensor {
  sameShape(y.shape, gy.shape, "softmax_backward");
  const { rows, cols } = rowsOf(y.shape, "softmax_backward");
  const Y = f32(y);
  const G = f32(gy);
  const out = new Float32Array(Y.length);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let dot = 0;
    for (let c = 0; c < cols; c++) dot += G[base + c]! * Y[base + c]!;
    for (let c = 0; c < cols; c++) out[base + c] = Y[base + c]! * (G[base + c]! - dot);
  }
  return dense(out, y.shape);
}

export function logSoftmax(a: Tensor): Tensor {
  const { rows, cols } = rowsOf(a.shape, "log_softmax");
  const A = f32(a);
  const out = new Float32Array(A.length);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let m = -Infinity;
    for (let c = 0; c < cols; c++) m = Math.max(m, A[base + c]!);
    let s = 0;
    for (let c = 0; c < cols; c++) s += Math.exp(A[base + c]! - m);
    const lse = m + Math.log(s);
    for (let c = 0; c < cols; c++) out[base + c] = A[base + c]! - lse;
  }
  return dense(out, a.shape);
}

export function logSoftmaxBackward(y: Tensor, gy: Tensor): Tensor {
  sameShape(y.shape, gy.shape, "log_softmax_backward");
  const { rows, cols } = rowsOf(y.shape, "log_softmax_backward");
  const Y = f32(y);
  const G = f32(gy);
  const out = new Float32Array(Y.length);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let s = 0;
    for (let c = 0; c < cols; c++) s += G[base + c]!;
    for (let c = 0; c < cols; c++) out[base + c] = G[base + c]! - Math.exp(Y[base + c]!) * s;
  }
  return dense(out, y.shape);
}

export function layerNorm(x: Tensor, gamma: Tensor | null, beta: Tensor | null, eps: number): LayerNormForward<Tensor> {
  const { rows, cols } = rowsOf(x.shape, "layer_norm");
  const X = f32(x);
  const y = new Float32Array(X.length);
  const mean = new Float32Array(rows);
  const rstd = new Float32Array(rows);
  const g = gamma ? f32(gamma) : null;
  const b = beta ? f32(beta) : null;
  for (let r = 0; r < rows; r++) {
    normalizeOne(y, r * cols, X, r * cols, 1, cols, eps, g, b, { mean, rstd, row: r });
  }
  const statShape = x.shape.slice(0, -1);
  return { y: dense(y, x.shape), mean: dense(mean, statShape), rstd: dense(rstd, statShape) };
}

export function layerNormBackward(
  x: Tensor,
  gamma: Tensor | null,
  meanT: Tensor,
  rstdT: Tensor,
  gy: Tensor,
  withAffine: boolean,
): LayerNormBackward<Tensor> {
  const { rows, cols } = rowsOf(x.shape, "layer_norm_backward");
  const X = f32(x);
  const G = f32(gy);
  const mean = f32(meanT);
  const rstd = f32(rstdT);
  const g = gamma ? f32(gamma) : null;
  const gx = new Float32Array(X.length);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let sumG = 0;
    let sumGX = 0;
    for (let c = 0; c < cols; c++) {
      const gh = G[base + c]! * (g ? g[c]! : 1);
      const xh = (X[base + c]! - mean[r]!) * rstd[r]!;
      sumG += gh;
      sumGX += gh * xh;
    }
    for (let c = 0; c < cols; c++) {
      const gh = G[base + c]! * (g ? g[c]! : 1);
      const xh = (X[base + c]! - mean[r]!) * rstd[r]!;
      gx[base + c] = (rstd[r]! / cols) * (cols * gh - sumG - xh * sumGX);
    }
  }
  if (!withAffine) return { gx: dense(gx, x.shape), gGamma: null, gBeta: null };
  const gGamma = new Float32Array(cols);
  const gBeta = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    let sg = 0;
    let sb = 0;
    for (let r = 0; r < rows; r++) {
      const gyv = G[r * cols + c]!;
      sg += gyv * (X[r * cols + c]! - mean[r]!) * rstd[r]!;
      sb += gyv;
    }
    gGamma[c] = sg;
    gBeta[c] = sb;
  }
  return { gx: dense(gx, x.shape), gGamma: dense(gGamma, [cols]), gBeta: dense(gBeta, [cols]) };
}

export function embeddingBackward(ids: Tensor, gy: Tensor, numEmbeddings: number): Tensor {
  const I = readIds(ids);
  const G = f32(gy);
  const D = gy.shape[gy.shape.length - 1]!;
  const out = new Float32Array(numEmbeddings * D);
  for (let n = 0; n < I.length; n++) {
    const id = I[n]!;
    for (let d = 0; d < D; d++) out[id * D + d]! += G[n * D + d]!;
  }
  return dense(out, [numEmbeddings, D]);
}

export function crossEntropy(logits: Tensor, targets: Tensor): CrossEntropyForward<Tensor> {
  if (logits.shape.length !== 2) throw new Error("cross_entropy: logits must be [N, C]");
  const [N, C] = [logits.shape[0]!, logits.shape[1]!];
  const L = f32(logits);
  const T = readIds(targets);
  if (T.length !== N) throw new Error(`cross_entropy: ${T.length} targets for ${N} rows`);
  const probs = new Float32Array(N * C);
  const loss = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const base = n * C;
    const t = T[n]!;
    if (t < 0 || t >= C) throw new Error(`cross_entropy: target ${t} out of range [0, ${C})`);
    let m = -Infinity;
    for (let c = 0; c < C; c++) m = Math.max(m, L[base + c]!);
    let s = 0;
    for (let c = 0; c < C; c++) s += Math.exp(L[base + c]! - m);
    for (let c = 0; c < C; c++) probs[base + c] = Math.exp(L[base + c]! - m) / s;
    loss[n] = m + Math.log(s) - L[base + t]!;
  }
  return { loss: dense(loss, [N]), probs: dense(probs, [N, C]) };
}

export function crossEntropyBackward(probs: Tensor, targets: Tensor, gLoss: Tensor): Tensor {
  const [N, C] = [probs.shape[0]!, probs.shape[1]!];
  const P = f32(probs);
  const T = readIds(targets);
  const G = f32(gLoss);
  const out = new Float32Array(N * C);
  for (let n = 0; n < N; n++) {
    for (let c = 0; c < C; c++) {
      out[n * C + c] = (P[n * C + c]! - (c === T[n] ? 1 : 0)) * G[n]!;
    }
  }
  return dense(out, [N, C]);
}

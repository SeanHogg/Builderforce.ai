import { mulScalar } from "../ops/elementwise";
import { matmul } from "../ops/matmul";
import { softmax } from "../ops/activation";
import { transpose } from "../ops/shape";
import { Tensor } from "../tensor";

/**
 * Scaled dot-product attention.
 *   q, k, v : [..., L, D]
 *   out     : [..., L, D] (or [..., L_q, D] when L_q != L_k)
 *
 *   attn = softmax( (Q @ K^T) / sqrt(D) ) @ V
 *
 * No masking, no dropout, no kv-cache — those are V1+ concerns.
 */
export function scaledDotProductAttention(q: Tensor, k: Tensor, v: Tensor): Tensor {
  if (q.dtype !== "float32" || k.dtype !== "float32" || v.dtype !== "float32") {
    throw new Error("scaledDotProductAttention: float32 only");
  }
  if (q.ndim < 2 || k.ndim < 2 || v.ndim < 2) {
    throw new Error("scaledDotProductAttention: q/k/v must each be at least 2D");
  }
  const D = q.shape[q.ndim - 1]!;
  const scale = 1 / Math.sqrt(D);
  const kT = transpose(k, -2, -1);
  const scores = mulScalar(matmul(q, kT), scale);
  const probs = softmax(scores, -1);
  return matmul(probs, v);
}

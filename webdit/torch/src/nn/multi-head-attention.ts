import { mulScalar } from "../ops/elementwise";
import { matmul } from "../ops/matmul";
import { softmax } from "../ops/activation";
import { permute, reshape, transpose } from "../ops/shape";
import { Tensor } from "../tensor";
import { Linear } from "./linear";
import { applyRope, type RopeFreqs } from "./rope";

/**
 * Multi-head self-attention with optional RoPE on Q/K.
 *
 *   x       : [B, L, D]
 *   q,k,v   : [B, L, D] = projections of x
 *   reshape : [B, L, H, D/H] -> [B, H, L, D/H]
 *   scores  : softmax((Q @ K^T) / sqrt(D/H))
 *   out     : (scores @ V) -> [B, L, D] -> outProj
 */
export class MultiHeadAttention {
  readonly headDim: number;
  readonly hiddenDim: number;

  constructor(
    readonly qProj: Linear,
    readonly kProj: Linear,
    readonly vProj: Linear,
    readonly outProj: Linear,
    readonly numHeads: number,
  ) {
    this.hiddenDim = qProj.outFeatures;
    if (this.hiddenDim % numHeads !== 0) {
      throw new Error(
        `MultiHeadAttention: hidden dim ${this.hiddenDim} not divisible by ${numHeads} heads`,
      );
    }
    this.headDim = this.hiddenDim / numHeads;
  }

  forward(x: Tensor, rope?: RopeFreqs): Tensor {
    if (x.ndim !== 3) {
      throw new Error(`MultiHeadAttention.forward: expected 3D [B, L, D], got ${x.ndim}D`);
    }
    const B = x.shape[0]!;
    const L = x.shape[1]!;
    const D = this.hiddenDim;
    const H = this.numHeads;
    const Dh = this.headDim;

    const q4 = permute(reshape(this.qProj.forward(x), [B, L, H, Dh]), [0, 2, 1, 3]);
    const k4 = permute(reshape(this.kProj.forward(x), [B, L, H, Dh]), [0, 2, 1, 3]);
    const v4 = permute(reshape(this.vProj.forward(x), [B, L, H, Dh]), [0, 2, 1, 3]);

    const q = rope ? applyRope(q4.contiguous(), rope) : q4;
    const k = rope ? applyRope(k4.contiguous(), rope) : k4;
    const v = v4;

    const scale = 1 / Math.sqrt(Dh);
    const scores = mulScalar(matmul(q, transpose(k, -2, -1)), scale); // [B, H, L, L]
    const probs = softmax(scores, -1);
    const out4 = matmul(probs, v); // [B, H, L, Dh]
    const merged = reshape(permute(out4, [0, 2, 1, 3]).contiguous(), [B, L, D]);
    return this.outProj.forward(merged);
  }
}

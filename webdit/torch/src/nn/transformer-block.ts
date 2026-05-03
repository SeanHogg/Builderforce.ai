import { add, mul } from "../ops/elementwise";
import { gelu } from "../ops/activation";
import { unsqueeze } from "../ops/shape";
import { expand } from "../ops/shape";
import { Tensor } from "../tensor";
import { LayerNorm } from "./layer-norm";
import { Linear } from "./linear";
import { MultiHeadAttention } from "./multi-head-attention";
import type { RopeFreqs } from "./rope";

/**
 * Pre-norm transformer block with additive timestep+text conditioning.
 *
 *   x = x + condition (broadcast over L)
 *   x = x + attn(norm1(x), rope)
 *   x = x + mlp(norm2(x))
 *
 * V0 simplification: conditioning is added at the block input rather than
 * via AdaLN-Zero modulation (which adds 6 modulation params per block).
 * Quality drops vs full DiT but the structure is faithful and the path
 * exercises all the same primitives.
 */
export class TransformerBlock {
  constructor(
    readonly norm1: LayerNorm,
    readonly attn: MultiHeadAttention,
    readonly norm2: LayerNorm,
    readonly mlpUp: Linear,
    readonly mlpDown: Linear,
  ) {}

  forward(x: Tensor, condition: Tensor, rope?: RopeFreqs): Tensor {
    // x         : [B, L, D]
    // condition : [B, D]    (broadcast across L)
    if (condition.ndim !== 2) {
      throw new Error(
        `TransformerBlock: condition must be 2D [B, D], got ${condition.ndim}D`,
      );
    }
    const condBcast = expand(unsqueeze(condition, 1), x.shape);
    let h = add(x, condBcast);
    h = add(h, this.attn.forward(this.norm1.forward(h), rope));
    h = add(h, this.mlpDown.forward(gelu(this.mlpUp.forward(this.norm2.forward(h)))));
    // The unused `mul` import is for downstream gated-residual variants.
    void mul;
    return h;
  }
}

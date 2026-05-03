import { add } from "../ops/elementwise";
import { matmul } from "../ops/matmul";
import { transpose } from "../ops/shape";
import { Tensor } from "../tensor";

/**
 * y = x @ weight^T + bias
 *
 *   x      : [..., in_features]
 *   weight : [out_features, in_features]   — PyTorch convention
 *   bias   : [out_features] (optional)
 *   y      : [..., out_features]
 */
export class Linear {
  readonly inFeatures: number;
  readonly outFeatures: number;

  constructor(
    readonly weight: Tensor,
    readonly bias: Tensor | null = null,
  ) {
    if (weight.ndim !== 2) {
      throw new Error(`Linear: weight must be 2D [out, in], got ${weight.ndim}D`);
    }
    this.outFeatures = weight.shape[0]!;
    this.inFeatures = weight.shape[1]!;
    if (bias && (bias.ndim !== 1 || bias.shape[0] !== this.outFeatures)) {
      throw new Error(
        `Linear: bias must be [${this.outFeatures}], got ${JSON.stringify(bias.shape)}`,
      );
    }
  }

  forward(x: Tensor): Tensor {
    if (x.shape[x.ndim - 1] !== this.inFeatures) {
      throw new Error(
        `Linear.forward: last dim ${x.shape[x.ndim - 1]} != inFeatures ${this.inFeatures}`,
      );
    }
    const wT = transpose(this.weight, 0, 1);
    const y = matmul(x, wT);
    return this.bias ? add(y, this.bias) : y;
  }
}

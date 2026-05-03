import { silu } from "../ops/activation";
import { unsqueeze } from "../ops/shape";
import { Tensor } from "../tensor";
import { Linear } from "./linear";

/**
 * Sinusoidal positional embedding for diffusion timesteps. Same pattern as
 * the original Transformer paper, but applied to the noise level instead
 * of token positions.
 *
 *   half = dim / 2
 *   embedding[d]      = sin(t * base^(-d/half))    for d in 0..half
 *   embedding[half+d] = cos(t * base^(-d/half))
 */
export function sinusoidalEmbedding(t: number, dim: number, base = 10000): Tensor {
  const half = Math.floor(dim / 2);
  const data = new Float32Array(dim);
  for (let d = 0; d < half; d++) {
    const freq = Math.pow(base, -d / Math.max(1, half));
    data[d] = Math.sin(t * freq);
    data[half + d] = Math.cos(t * freq);
  }
  return Tensor.contiguous(data, [dim], "float32");
}

/**
 * Standard DiT-style timestep MLP:
 *   t (scalar) -> sinusoidal (inDim) -> Linear -> SiLU -> Linear -> [1, hiddenDim]
 */
export class TimestepEmbedding {
  constructor(
    readonly proj1: Linear,
    readonly proj2: Linear,
    readonly inDim: number = 256,
  ) {
    if (proj1.inFeatures !== inDim) {
      throw new Error(`TimestepEmbedding: proj1 in_features ${proj1.inFeatures} != inDim ${inDim}`);
    }
    if (proj1.outFeatures !== proj2.inFeatures) {
      throw new Error(
        `TimestepEmbedding: proj1.out (${proj1.outFeatures}) != proj2.in (${proj2.inFeatures})`,
      );
    }
  }

  forward(t: number): Tensor {
    const sinu = sinusoidalEmbedding(t, this.inDim);
    const x = unsqueeze(sinu, 0); // [1, inDim]
    const h = silu(this.proj1.forward(x));
    return this.proj2.forward(h); // [1, hiddenDim]
  }
}

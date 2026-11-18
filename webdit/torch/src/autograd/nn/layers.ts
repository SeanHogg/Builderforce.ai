import { ones, randn, uniform, zeros, type TensorOptions } from "../creation";
import type { DeviceTensor } from "../device-tensor";
import { linear } from "../functional/linalg";
import { embedding, layerNorm } from "../functional/nn";
import { Module } from "./module";

/**
 * Trainable layers. Initialization follows PyTorch: Linear draws weight and
 * bias from U(-1/√in, 1/√in); Embedding from N(0, 1); LayerNorm starts at the
 * identity (γ = 1, β = 0). Draws come from the seeded stream (`manualSeed`).
 */

export interface LayerOptions {
  backend?: TensorOptions["backend"];
  bias?: boolean;
}

export class Linear extends Module {
  readonly weight: DeviceTensor;
  readonly bias: DeviceTensor | null;

  constructor(
    readonly inFeatures: number,
    readonly outFeatures: number,
    options: LayerOptions = {},
  ) {
    super();
    const bound = 1 / Math.sqrt(inFeatures);
    const o = { backend: options.backend, requiresGrad: true };
    this.weight = this.registerParameter("weight", uniform([outFeatures, inFeatures], -bound, bound, o));
    this.bias = options.bias === false ? null : this.registerParameter("bias", uniform([outFeatures], -bound, bound, o));
  }

  forward(x: DeviceTensor): DeviceTensor {
    return linear(x, this.weight, this.bias);
  }
}

export class Embedding extends Module {
  readonly weight: DeviceTensor;

  constructor(
    readonly numEmbeddings: number,
    readonly embeddingDim: number,
    options: Pick<LayerOptions, "backend"> = {},
  ) {
    super();
    this.weight = this.registerParameter(
      "weight",
      randn([numEmbeddings, embeddingDim], { backend: options.backend, requiresGrad: true }),
    );
  }

  forward(ids: DeviceTensor): DeviceTensor {
    return embedding(ids, this.weight);
  }
}

export class LayerNorm extends Module {
  readonly weight: DeviceTensor | null;
  readonly bias: DeviceTensor | null;

  constructor(
    readonly normalizedShape: number,
    readonly eps = 1e-5,
    options: Pick<LayerOptions, "backend"> & { elementwiseAffine?: boolean } = {},
  ) {
    super();
    const affine = options.elementwiseAffine ?? true;
    const o = { backend: options.backend, requiresGrad: true };
    this.weight = affine ? this.registerParameter("weight", ones([normalizedShape], o)) : null;
    this.bias = affine ? this.registerParameter("bias", zeros([normalizedShape], o)) : null;
  }

  forward(x: DeviceTensor): DeviceTensor {
    return layerNorm(x, this.weight, this.bias, this.eps);
  }
}

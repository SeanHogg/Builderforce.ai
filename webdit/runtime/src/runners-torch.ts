import type { QuantizedTensor, WebDiTManifest } from "@webdit/shared";
import { Tensor, tensorOf } from "@webdit/torch";
import { loadRealMini, type RealMiniDit, type RealMiniTextEncoder, type RealMiniVae } from "./torch-arch/real-mini";
import type { DitRunner, TextEncoderRunner, VaeRunner } from "./runners";
import type { MutableTensor } from "./types";

/**
 * Torch-backed runners for the `real-mini` architecture. Reads weights from
 * shards (load-bearing!), wraps them in @webdit/torch tensors, runs forward
 * passes through real DiT modules.
 */

export class TorchDitRunner implements DitRunner {
  constructor(private readonly model: RealMiniDit) {}

  async run(latent: MutableTensor, t: number, textEmb: MutableTensor): Promise<MutableTensor> {
    const latentT = tensorOf(latent.data, [...latent.dims], "float32");
    const textT = tensorOf(textEmb.data, [...textEmb.dims], "float32");
    const out = this.model.forward(latentT, t, textT);
    const c = out.contiguous();
    return { data: c.data as Float32Array, dims: c.shape };
  }
}

export class TorchTextEncoderRunner implements TextEncoderRunner {
  constructor(private readonly model: RealMiniTextEncoder) {}

  async run(inputIds: BigInt64Array, _attentionMask: BigInt64Array): Promise<MutableTensor> {
    const out = this.model.forward(inputIds);
    return { data: out.data as Float32Array, dims: out.shape };
  }
}

export class TorchVaeRunner implements VaeRunner {
  constructor(private readonly model: RealMiniVae) {}

  async run(latent: MutableTensor): Promise<Float32Array> {
    const latentT = tensorOf(latent.data, [...latent.dims], "float32");
    const out = this.model.forward(latentT);
    return out.contiguous().data as Float32Array;
  }
}

export interface TorchBundleParts {
  dit: DitRunner;
  textEncoder: TextEncoderRunner;
  vae: VaeRunner;
}

export function buildTorchRunners(
  manifest: WebDiTManifest,
  ditWeights: Map<string, QuantizedTensor>,
  textEncoderWeights: Map<string, QuantizedTensor>,
  vaeWeights: Map<string, QuantizedTensor>,
): TorchBundleParts {
  if (manifest.architecture !== "real-mini") {
    throw new Error(
      `buildTorchRunners: only 'real-mini' is supported (got '${manifest.architecture}')`,
    );
  }
  const { dit, textEncoder, vae } = loadRealMini(ditWeights, textEncoderWeights, vaeWeights);
  return {
    dit: new TorchDitRunner(dit),
    textEncoder: new TorchTextEncoderRunner(textEncoder),
    vae: new TorchVaeRunner(vae),
  };
}

// Avoid unused-import warning for Tensor (used via tensorOf return type chains).
void Tensor;

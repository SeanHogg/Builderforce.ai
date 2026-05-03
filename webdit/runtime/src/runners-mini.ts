import { dequantize, type QuantizedTensor, type WebDiTManifest } from "@webdit/shared";
import type { DitRunner, TextEncoderRunner, VaeRunner } from "./runners";
import type { MutableTensor } from "./types";

/**
 * Pure-JS forward passes for the `mini-test` architecture. Reads weights
 * directly from quantized shards — making the shard format load-bearing
 * (in contrast to the ORT path, where ONNX-embedded weights drive inference).
 *
 * Math is intentionally trivial: this exists to flow real bytes through the
 * full pipeline for integration testing, NOT to produce meaningful video.
 */

export class MiniDitRunner implements DitRunner {
  private readonly scale: Float32Array;
  private readonly bias: Float32Array;

  constructor(weights: Map<string, QuantizedTensor>) {
    this.scale = requireWeight(weights, "dit.scale");
    this.bias = requireWeight(weights, "dit.bias");
  }

  async run(latent: MutableTensor, t: number, textEmb: MutableTensor): Promise<MutableTensor> {
    const dims = latent.dims;
    if (dims.length !== 5) {
      throw new Error(`MiniDitRunner: expected 5D latent, got ${dims.length}D`);
    }
    const [_b, c, T, H, W] = dims as readonly [number, number, number, number, number];
    const planeSize = T * H * W;

    let textPool = 0;
    for (const v of textEmb.data) textPool += v;
    textPool /= Math.max(1, textEmb.data.length);

    const out = new Float32Array(latent.data.length);
    for (let ci = 0; ci < c; ci++) {
      const s = this.scale[ci]! * t;
      const b = this.bias[ci]! + textPool;
      const base = ci * planeSize;
      for (let p = 0; p < planeSize; p++) {
        const idx = base + p;
        out[idx] = latent.data[idx]! * s + b;
      }
    }
    return { data: out, dims };
  }
}

export class MiniTextEncoderRunner implements TextEncoderRunner {
  private readonly proj: Float32Array;
  private readonly vocab: number;
  private readonly embedDim: number;

  constructor(weights: Map<string, QuantizedTensor>, manifest: WebDiTManifest) {
    const tensor = requireWeightWithShape(weights, "te.proj");
    this.proj = tensor.data;
    this.vocab = tensor.shape[0]!;
    this.embedDim = tensor.shape[1]!;
    if (manifest.textEncoder.embedDim !== this.embedDim) {
      throw new Error(
        `MiniTextEncoderRunner: manifest embedDim=${manifest.textEncoder.embedDim} ` +
          `but te.proj is [${this.vocab}, ${this.embedDim}]`,
      );
    }
  }

  async run(inputIds: BigInt64Array, _attentionMask: BigInt64Array): Promise<MutableTensor> {
    const L = inputIds.length;
    const D = this.embedDim;
    const out = new Float32Array(L * D);
    for (let l = 0; l < L; l++) {
      const id = Number(inputIds[l]!) % this.vocab;
      const safeId = id < 0 ? id + this.vocab : id;
      const src = safeId * D;
      const dst = l * D;
      for (let d = 0; d < D; d++) out[dst + d] = this.proj[src + d]!;
    }
    return { data: out, dims: [1, L, D] };
  }
}

export class MiniVaeRunner implements VaeRunner {
  private readonly proj: Float32Array;
  private readonly outChannels: number;
  private readonly inChannels: number;
  private readonly spatialUp: number;
  private readonly temporalUp: number;

  constructor(weights: Map<string, QuantizedTensor>, manifest: WebDiTManifest) {
    const tensor = requireWeightWithShape(weights, "vae.proj");
    this.proj = tensor.data;
    this.outChannels = tensor.shape[0]!;
    this.inChannels = tensor.shape[1]!;
    this.spatialUp = manifest.vaeCompression.spatial;
    this.temporalUp = manifest.vaeCompression.temporal;
  }

  async run(latent: MutableTensor): Promise<Float32Array> {
    const [_b, c, T, H, W] = latent.dims as readonly [number, number, number, number, number];
    if (c !== this.inChannels) {
      throw new Error(
        `MiniVaeRunner: latent channels=${c} but vae.proj expects ${this.inChannels}`,
      );
    }
    const Tout = T * this.temporalUp;
    const Hout = H * this.spatialUp;
    const Wout = W * this.spatialUp;
    const outChan = this.outChannels;
    const out = new Float32Array(outChan * Tout * Hout * Wout);
    const planeIn = T * H * W;
    const planeOut = Tout * Hout * Wout;

    // For each output position, find the source latent voxel and project channels.
    for (let oc = 0; oc < outChan; oc++) {
      for (let t = 0; t < Tout; t++) {
        for (let h = 0; h < Hout; h++) {
          for (let w = 0; w < Wout; w++) {
            const it = Math.floor(t / this.temporalUp);
            const ih = Math.floor(h / this.spatialUp);
            const iw = Math.floor(w / this.spatialUp);
            let acc = 0;
            for (let ic = 0; ic < this.inChannels; ic++) {
              const lat = latent.data[ic * planeIn + it * H * W + ih * W + iw]!;
              acc += lat * this.proj[oc * this.inChannels + ic]!;
            }
            // Squash through tanh to keep output in [-1, 1] range expected by splitFrames.
            out[oc * planeOut + t * Hout * Wout + h * Wout + w] = Math.tanh(acc);
          }
        }
      }
    }
    return out;
  }
}

function requireWeight(weights: Map<string, QuantizedTensor>, name: string): Float32Array {
  return requireWeightWithShape(weights, name).data;
}

function requireWeightWithShape(
  weights: Map<string, QuantizedTensor>,
  name: string,
): { data: Float32Array; shape: readonly number[] } {
  const t = weights.get(name);
  if (!t) {
    throw new Error(
      `MiniRunner: missing required weight '${name}'. Available: ${Array.from(weights.keys()).join(", ") || "<none>"}`,
    );
  }
  return { data: dequantize(t), shape: t.shape };
}

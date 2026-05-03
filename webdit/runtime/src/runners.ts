import type { MutableTensor } from "./types";

/**
 * Backend-agnostic forward-pass interfaces. Both the ORT runner (production,
 * loads ONNX graphs via onnxruntime-web) and the Mini runner (tests, runs
 * pure-JS math on quantized shards) implement these. The denoise loop is
 * written against these interfaces and doesn't know which backend is active.
 */

export interface DitRunner {
  run(latent: MutableTensor, timestep: number, textEmb: MutableTensor): Promise<MutableTensor>;
  release?(): Promise<void>;
}

export interface TextEncoderRunner {
  run(inputIds: BigInt64Array, attentionMask: BigInt64Array): Promise<MutableTensor>;
  release?(): Promise<void>;
}

export interface VaeRunner {
  /** Returns flat RGB pixels [B, C=3, T, H, W] in [-1, 1]. */
  run(latent: MutableTensor): Promise<Float32Array>;
  release?(): Promise<void>;
}

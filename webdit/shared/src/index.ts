/**
 * WebDiT bundle format — single source of truth for the contract between
 * the converter (which writes bundles) and the runtime (which loads them).
 *
 * Bundle directory layout served over HTTP:
 *   manifest.json               WebDiTManifest serialized
 *   graph/dit.onnx              DiT graph (ONNX, custom ops where ORT-Web lacks them)
 *   graph/text_encoder.onnx     CLIP-L by default; T5-base/T5-XXL opt-in
 *   graph/vae.onnx              VAE decoder graph
 *   weights/dit_shard_*.bin     DiT weights, sharded for streaming load
 *   weights/text_encoder.bin
 *   weights/vae.bin
 *   tokenizer/tokenizer.json    HF tokenizer.json + tokenizer_config.json
 */

export type WebDiTArchitecture =
  | "ltx2-distilled"
  | "wan2.5"
  | "mochi-1"
  | "cogvideox-2b"
  | "mini-test"
  | "real-mini";

export type WebDiTQuantization = "q4f16_1" | "q8f16_0" | "f16";

export type SchedulerKind = "flow-match-rect" | "euler" | "dpm++-2m";

export type TextEncoderKind = "clip-l" | "t5-base" | "t5-xxl" | "mini-hash";

/**
 * Execution backend selected at bundle build time. ORT runs the .onnx graphs
 * via ORT-Web/WebGPU. Mini bypasses ONNX entirely and uses pure-JS forward
 * passes that read weights directly from our shard format — used for the
 * built-in `mini-test` architecture and for integration tests where we need
 * real bytes flowing without depending on a real ONNX export.
 */
export type Backend = "ort" | "mini" | "torch";

export interface LatentShape {
  /** Latent channels. */
  c: number;
  /** Temporal length (frames in latent space). */
  t: number;
  /** Latent height. */
  h: number;
  /** Latent width. */
  w: number;
}

export interface VaeCompression {
  /** Pixel = latent * spatial. */
  spatial: number;
  /** Pixel-frames = latent-frames * temporal. */
  temporal: number;
}

export interface PatchSize {
  d: number;
  h: number;
  w: number;
}

export interface SamplingDefaults {
  steps: number;
  guidanceScale: number;
  frames: number;
  height: number;
  width: number;
}

export interface BundleFiles {
  ditGraph: string;
  ditWeightShards: string[];
  textEncoderGraph: string;
  textEncoderWeights: string;
  vaeGraph: string;
  vaeWeights: string;
  /** Directory (trailing slash) holding tokenizer.json + tokenizer_config.json. */
  tokenizer: string;
}

export interface WebDiTManifest {
  bundleVersion: 1;
  architecture: WebDiTArchitecture;
  quantization: WebDiTQuantization;
  scheduler: SchedulerKind;
  backend: Backend;

  latentShape: LatentShape;
  vaeCompression: VaeCompression;
  patchSize: PatchSize;

  textEncoder: {
    kind: TextEncoderKind;
    maxTokens: number;
    embedDim: number;
  };

  defaults: SamplingDefaults;
  files: BundleFiles;
}

/**
 * ONNX graph I/O naming convention. Whoever pre-exports the upstream model
 * (LTX/Wan/Mochi) MUST emit graphs with these input/output names; the runtime
 * calls session.run() against them. Single source of truth — change here and
 * both sides recompile against it.
 *
 * Layout convention for tensors:
 *   latent  : float32 [B, C, T, H, W]    (B=1 in our denoise loop)
 *   text_emb: float32 [B, L, D]
 *   pixels  : float32 [B, C=3, T, H, W]  range [-1, 1], before splitFrames
 */
export const BUNDLE_IO = {
  dit: {
    inputs: { latent: "latent", timestep: "timestep", textEmb: "text_emb" },
    outputs: { velocity: "velocity" },
  },
  textEncoder: {
    inputs: { inputIds: "input_ids", attentionMask: "attention_mask" },
    outputs: { embeddings: "text_emb" },
  },
  vae: {
    inputs: { latent: "latent" },
    outputs: { pixels: "pixels" },
  },
} as const;

export {
  KNOWN_ARCHITECTURES,
  KNOWN_QUANTIZATIONS,
  KNOWN_SCHEDULERS,
  KNOWN_TEXT_ENCODERS,
  KNOWN_BACKENDS,
  validateManifest,
} from "./validate";

export {
  Q4_GROUP,
  floatToHalf,
  halfToFloat,
  bfloat16ToFloat,
  dequantize,
  type QuantizedTensor,
} from "./quant";

export {
  packShard,
  parseBundleShard,
  type PackedShard,
  type ShardSummary,
} from "./shard";

/**
 * WebDiT bundle format — single source of truth for the contract between
 * the converter (which writes bundles) and the runtime (which loads them).
 *
 * Bundle directory layout served over HTTP:
 *   manifest.json               WebDiTManifest serialized
 *   graph/dit.onnx              DiT graph (ONNX, custom ops where ORT-Web lacks them)
 *   graph/text_encoder.onnx     whichever `TextEncoderKind` the architecture's
 *                               real upstream model uses (e.g. cogvideox-2b's
 *                               real text encoder is T5-XXL, not CLIP-L)
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

export type SchedulerKind = "flow-match-rect" | "euler" | "dpm++-2m" | "ddim-vpred-zsnr";

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
  /**
   * Pixel-frames = latent-frames * temporal — UNLESS `causal` is set (see
   * below), in which case the first frame is a special case and this ratio
   * only applies to the rest.
   */
  temporal: number;
  /**
   * Set for a causal 3D VAE (CogVideoX, and — per their published
   * architectures — LTX-2/Wan2.5/Mochi-1 too): the first output frame comes
   * from a single latent step with no temporal compression, so
   * `pixelFrames = (latentFrames - 1) * temporal + 1`, NOT the naive
   * `latentFrames * temporal`. Getting this wrong doesn't just miscount
   * frames — `runDenoiseLoop` uses it to size the VAE's decoded output
   * before `splitFrames`, so a wrong formula throws a hard shape-mismatch
   * error on every real generation. Defaults to `false` (the plain
   * multiplicative formula) when absent, matching every manifest written
   * before this field existed.
   */
  causal?: boolean;
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
  /**
   * Companion ONNX external-data file for `ditGraph`, present only when the
   * graph's embedded weights exceed the ~2GB single-protobuf-file limit
   * (any real DiT backbone — e.g. cogvideox-2b's 2B-param transformer at
   * fp32 is ~8GB). `undefined` means the graph is fully self-contained.
   * The runtime passes it via ORT-Web's `SessionOptions.externalData` — see
   * `buildOrtBundle`/`buildOrtBundleFromBuffers` in `runtime/src/bundle.ts`.
   * The `location` string the exporter embedded inside the .onnx protobuf
   * (via `onnx.save_model(..., location=...)`) MUST equal this path's
   * basename — that's what ORT-Web matches it against.
   */
  ditGraphData?: string;
  ditWeightShards: string[];
  textEncoderGraph: string;
  /** See `ditGraphData` — same convention, for the text encoder graph
   *  (near-certain to need this: a real T5-XXL encoder is several GB). */
  textEncoderGraphData?: string;
  textEncoderWeights: string;
  vaeGraph: string;
  /** See `ditGraphData` — same convention, for the VAE decoder graph. */
  vaeGraphData?: string;
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

/**
 * Public types for @seanhogg/builderforce-studio.
 *
 * MambaStateSnapshot is the canonical shape for SSM state serialization across
 * the studio engine, the host frontend (frontend/src/lib/mamba-engine.ts), and
 * the published agent packages stored in R2. Keep this shape stable — agent
 * packages already in the wild depend on it.
 */

/** Compact snapshot of a Mamba SSM state vector, serialisable to IndexedDB / R2 / JSON. */
export interface MambaStateSnapshot {
  /** Packed Float32 values encoded as a plain number array for JSON portability. */
  data: number[];
  /** Dimensionality of each state channel. */
  dim: number;
  /** SSM order (hidden states per channel). */
  order: number;
  /** Number of parallel channels. */
  channels: number;
  /** Monotonically increasing sequence counter. */
  step: number;
}

/** Hardware execution target. `auto` probes WebNN → WebGPU → CPU and picks the first that initialises. */
export type DeviceTarget = 'auto' | 'webnn' | 'webgpu' | 'cpu';

/** Active hardware path the engine ended up on, reported back to the consumer. */
export type ActiveDevice = 'webnn' | 'webgpu' | 'cpu';

/** Diffusion backbone. Ordered roughly smallest → largest VRAM footprint. */
export type DiffusionModelId = 'lcm-tiny-sd' | 'sd-turbo' | 'lcm-dreamshaper-v7';

/** Mamba-state-driven coherence mode. */
export type CoherenceMode = 'prompt-bias' | 'latent-residual';

/** Source for fetching model weights. The engine falls back across these in order. */
export type WeightSource = 'r2-proxy' | 'huggingface-cdn';

/** A single ONNX model file, plus an optional external-data sidecar.
 *  diffusers ONNX exports >2GB split weights into a `model.onnx` graph and a
 *  `model.onnx_data` tensor blob; onnxruntime-web needs both. */
export interface OnnxFile {
  /** Path within the HF repo, e.g. 'unet/model.onnx'. */
  model: string;
  /** Optional external-data sidecar, e.g. 'unet/model.onnx_data'. */
  externalData?: string;
}

export interface ModelDescriptor {
  id: DiffusionModelId;
  /** Number of denoising steps. LCM = 4, SD-Turbo = 1. */
  defaultSteps: number;
  /** Default classifier-free-guidance scale. */
  defaultGuidance: number;
  /** Minimum advertised VRAM in MB. The engine warns below this. */
  minVramMb: number;
  /** Hugging Face repo id for the raw-ORT text-encoder/UNet/VAE weight fetch
   *  through weight-cache.ts. */
  hfRepo: string;
  /** Separate transformers.js-native repo for the CLIP tokenizer. The model
   *  repos keep tokenizer files in a `tokenizer/` subfolder that AutoTokenizer
   *  can't load; SD's tokenizer is the standard CLIP BPE so a root-level CLIP
   *  repo produces identical token ids. */
  tokenizerRepo: string;
  /** Cross-attention dimension. SD1.x = 768, SD2.x / SD-Turbo = 1024. */
  textEmbedDim: number;
  /** Tokenizer max sequence length. 77 for CLIP-based SD. */
  sequenceLength: number;
  /** VAE scale factor applied before decoder. SD1.x = 0.18215, SDXL = 0.13025. */
  vaeScalingFactor: number;
  /** Diffusion timesteps the scheduler hits, ordered most-noisy → least. */
  defaultTimesteps: number[];
  /** ONNX weight files served via the studio R2 proxy / HF CDN fallback. */
  files: {
    textEncoder: OnnxFile;
    unet: OnnxFile;
    vaeDecoder: OnnxFile;
  };
  /** Exact UNet input tensor names + dtypes this model expects. The engine
   *  iterates this list to build feeds; any name missing a registered builder
   *  fails the registry-contract test before it can throw at runtime as
   *  "input 'X' is missing in 'feeds'". The dtype guards against the
   *  "Unexpected input data type" error class — e.g. LCM Dreamshaper expects
   *  `timestep` as float32, SD-Turbo as int64. */
  unetInputs: readonly OrtInputSpec[];
  /** Text-encoder input spec (same dtype hazard as the UNet — `input_ids`
   *  is int32 in some exports, int64 in others). */
  textEncoderInputs: readonly OrtInputSpec[];
  /** LCM consistency-model guidance-scale embedding dimension. Set on LCM
   *  exports (aislamov/* uses 256). When set, the engine produces a
   *  `timestep_cond` feed of shape [1, dim]. Leave undefined for non-LCM
   *  UNets (SD / SD-Turbo). */
  lcmGuidanceEmbedDim?: number;
}

/** Supported ONNX tensor dtypes the engine knows how to build feeds for. */
export type OrtTensorDtype = 'float32' | 'int32' | 'int64';

/** A single ORT session input — name (as declared in the model graph) + the
 *  tensor dtype ORT will accept for it. Wrong dtype → "Unexpected input data
 *  type" at runtime; the registry-contract test catches misdeclaration. */
export interface OrtInputSpec {
  name: string;
  dtype: OrtTensorDtype;
}

export interface VideoEngineOptions {
  /** Builderforce API key. Used to call the LLM gateway for prompt expansion. */
  apiKey: string;
  /** Builderforce gateway base URL. Defaults to https://api.builderforce.ai. */
  baseUrl?: string;
  /** Gateway model id used for prompt expansion. Defaults to googleai/gemini-2.5-flash-lite. */
  promptModel?: string;
  /** Which diffusion backbone to use. */
  model: DiffusionModelId;
  /** Hardware target. */
  device?: DeviceTarget;
  /** Weight source preference order. Defaults to ['r2-proxy', 'huggingface-cdn']. */
  weightSources?: WeightSource[];
  /** Optional initial Mamba state. If omitted, the engine starts from a zero state. */
  mambaState?: MambaStateSnapshot;
  /** Output dimensions. Defaults to 512x512. */
  width?: number;
  height?: number;
  /** Fine-grained progress messages emitted during `VideoEngine.create` —
   *  tokenizer / text-encoder / UNet / VAE downloads + ORT session creation.
   *  Each message is also `console.info`'d so devtools shows the timeline. */
  onProgress?: (label: string) => void;
}

export interface GenerateOptions {
  /** Short user prompt. The engine expands this through the LLM gateway before diffusion. */
  prompt: string;
  /** Skip LLM expansion and use the prompt verbatim. */
  skipPromptExpansion?: boolean;
  /** Total frame count to generate. */
  frames: number;
  /** Playback framerate of the output MP4. */
  fps: number;
  /** Override denoising steps (defaults to the model's defaultSteps). */
  steps?: number;
  /** Override classifier-free-guidance scale. */
  guidance?: number;
  /** Negative prompt (SD-Turbo only — LCM ignores). */
  negativePrompt?: string;
  /** Seed for the initial latent noise. Defaults to Date.now(). */
  seed?: number;
  /** How the Mamba state biases each frame. */
  coherence?: CoherenceMode;
  /** 0 = no coherence (pure i.i.d. frames), 1 = maximum lock to previous frame. */
  coherenceStrength?: number;
  /** Called once per finished frame. */
  onFrame?: (frameIdx: number, bitmap: ImageBitmap, state: MambaStateSnapshot) => void;
  /** Called when prompt expansion finishes (before diffusion starts). */
  onPromptExpanded?: (expanded: string) => void;
  /** Fine-grained progress messages emitted during generate — prompt expansion,
   *  text encoding, each frame's denoise steps, decode, MP4 mux. Use this to
   *  surface "what is the engine doing right now" between `onFrame` events
   *  (which only fire once per completed frame). Mirrors to console.info. */
  onProgress?: (label: string) => void;
  /** AbortSignal for cancelling generation mid-flight. */
  signal?: AbortSignal;
}

export interface GenerateResult {
  /** MP4 Blob ready for download, upload, or playback via URL.createObjectURL. */
  blob: Blob;
  /** Final Mamba state after the last frame. Round-trip to IDB or R2 to resume. */
  mambaState: MambaStateSnapshot;
  /** Raw frames if the consumer wants them. */
  frames: ImageBitmap[];
  /** Which device path was actually used. */
  activeDevice: ActiveDevice;
  /** The expanded prompt sent to the diffusion model. */
  resolvedPrompt: string;
  /** Total wall-clock generation time in milliseconds. */
  elapsedMs: number;
}

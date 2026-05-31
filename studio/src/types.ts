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

/**
 * Quality preset — the simple-mode user picks this instead of a specific model
 * and a stack of sliders. Maps onto a draft model + (optional) a refinement
 * model that runs each frame through img2img at low strength.
 *   fast      → single-pass lcm-tiny-sd (4 steps, ~2 GB, fastest to first frame)
 *   balanced  → single-pass lcm-dreamshaper-v7 (4 steps, ~6 GB, sharper)
 *   refined   → TWO PASSES: draft through lcm-tiny-sd, then refinement pass
 *               through lcm-dreamshaper-v7 via img2img at strength 0.4.
 *               Sequential model load (no 2× VRAM cost) — slower wall-clock
 *               but combines the tiny model's speed for composition with the
 *               larger model's detail for finishing. Answers the user's
 *               "why don't we use two LLMs?" question — this IS that.
 */
export type QualityMode = 'fast' | 'balanced' | 'refined';

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
  /**
   * Optional second-pass model. When set, `VideoEngine` runs two passes
   * per frame: the primary `model` produces a draft, then `refinementModel`
   * runs over each frame via img2img to add detail. The two models are
   * loaded SEQUENTIALLY (draft first, refinement second) so VRAM cost
   * stays at max(draft, refinement), not draft + refinement. Matches the
   * quality-tier `'refined'` preset surfaced in the embedded panel.
   */
  refinementModel?: DiffusionModelId;
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
  /**
   * How much fresh noise per frame is mixed into the shared anchor latent.
   * Diffusion outputs are dominated by initial noise, so sampling fresh noise
   * per frame produces visually unrelated stills. The engine instead picks one
   * anchor latent per clip and blends each frame as
   *   `latent = sqrt(1-motion) * anchor + sqrt(motion) * frameNoise`
   * Defaults to 0.15 — small enough for stable colors / composition across
   * frames, large enough to leave room for evolution. Set to 1 to opt out
   * (each frame becomes a fresh interpretation of the prompt — the old
   * behaviour that fails on "this should be a continuation" prompts).
   * Ignored when `imgToImgStrength > 0` for frames > 0 (img2img path takes over).
   */
  motionAmount?: number;
  /**
   * Img2img recursion strength for frames > 0. When 0 (default), every frame
   * starts from the shared anchor + per-frame noise (continuity but no scene
   * progression — the "same shot wobbling" failure mode). When > 0, frame
   * N+1 starts from frame N's clean latent re-noised partway through the
   * schedule: only the last `floor(steps * strength)` denoise steps run,
   * carrying scene content forward. Typical useful range: 0.4–0.7.
   *   0.5 → start halfway through the schedule (strong continuity, slow evolution)
   *   0.7 → start at 30 %  (moderate continuity, more evolution)
   *   1.0 → start at the beginning  (≈ pure anchor walk, same as 0)
   * Long clips (~30+ frames) drift / blur — refresh by setting back to 0 on
   * a periodic frame, or split into multiple short calls.
   */
  imgToImgStrength?: number;
  /**
   * Per-frame directional shift applied to the prior latent BEFORE re-noising,
   * in latent-pixel units (1 latent pixel = 8 output pixels via the VAE
   * down-factor). Simulates camera motion: dy=-1 looks like the camera
   * tilting up; dx=1 looks like the world panning right (camera moving left).
   * Only consulted when `imgToImgStrength > 0`. Default omitted = no shift.
   */
  cameraMotion?: { dx: number; dy: number };
  /**
   * Refinement-pass strength used when the engine runs the quality-tier
   * second pass. Each finished frame from the draft model is fed back into
   * the refinement model via img2img at this strength. Lower = preserves the
   * draft's composition more faithfully (less change); higher = lets the
   * refinement model rewrite more detail. Defaults to 0.4. Only consulted
   * when `VideoEngine.create` was given two models (refined quality tier).
   */
  refinementStrength?: number;
  /**
   * Keyframe interpolation factor. When > 1, only every Nth FINAL frame is
   * generated by the (expensive) diffusion denoise loop; the frames between
   * consecutive keyframes are produced by spherical-linear interpolation in
   * the VAE latent space + a single cheap VAE decode each. This is the
   * "generate major scene states, interpolate the rest" strategy — it cuts the
   * number of UNet denoise passes by ~`interpolationFactor`× while keeping
   * motion smooth.
   *   1 (default) → every frame fully generated (no interpolation).
   *   2           → generate keyframes, interpolate 1 tween between each pair.
   *   4           → generate keyframes, interpolate 3 tweens between each pair.
   * Mutually exclusive in spirit with `imgToImgStrength` (which carries scene
   * content frame-to-frame); when both are set, interpolation runs over the
   * generated keyframes and img2img recursion links the keyframes themselves.
   * A true RIFE/FILM optical-flow backend can replace latent slerp later —
   * tracked in the Consolidated Gap Register.
   */
  interpolationFactor?: number;
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

// ───────────────────────────────────────────────────────────────────────────
// Scene planning — the Director / Storyboard / Character / Shot-Planner layer.
//
// These types are the "shared memory bus" the planning agents read and write.
// A `Storyboard` is produced by `planScene()` (studio/src/engine/scene-planner.ts)
// from one user request, then consumed by `VideoEngine.generateStoryboard()`.
// The LLM does the reasoning (via the Builderforce gateway); diffusion never
// sees the raw user request, only the per-shot prompt the planner emits.
// ───────────────────────────────────────────────────────────────────────────

/**
 * One character's LOCKED visual description. The same `appearance` string is
 * appended to every shot prompt the character appears in, so the diffusion
 * model paints a consistent subject across shots (the feedback's "Character
 * Agent" — consistency is achieved by threading this descriptor, not by asking
 * the image model to "remember").
 */
export interface CharacterBible {
  /** Stable id referenced by `PlannedShot.characterIds`, e.g. "char-1". */
  id: string;
  name: string;
  /** Diffusion-ready appearance descriptor: age, build, hair, wardrobe, palette. */
  appearance: string;
}

/** Canonical camera moves the planner may request. Mapped to a latent-space
 *  pan/tilt (`cameraMotion` dx/dy) + an img2img strength by `cameraMoveToMotion`. */
export type CameraMove =
  | 'static'
  | 'pan-left'
  | 'pan-right'
  | 'tilt-up'
  | 'tilt-down'
  | 'dolly-in'
  | 'dolly-out';

/** One shot in a storyboard — a continuous run of frames sharing a prompt. */
export interface PlannedShot {
  id: string;
  /** Diffusion-ready prompt (subject, environment, lighting, palette, style).
   *  Character appearances are appended by the engine, not baked in here. */
  prompt: string;
  /** Ids of characters present — their `appearance` is appended to `prompt`. */
  characterIds: string[];
  /** Camera move for the shot. Drives `cameraMotion` + img2img recursion. */
  camera: CameraMove;
  /** What happens in the shot — used by the frame validator for continuity. */
  action: string;
  /** Number of FINAL output frames this shot occupies (post-interpolation). */
  durationFrames: number;
}

/** A full plan for one clip: the Director's treatment + character bible + shots. */
export interface Storyboard {
  /** One-paragraph treatment: tone, arc, setting. The Director agent's output. */
  treatment: string;
  characters: CharacterBible[];
  shots: PlannedShot[];
}

export interface ScenePlanOptions {
  apiKey: string;
  baseUrl?: string;
  /** Gateway model id for planning. Defaults to a strong reasoning model. */
  plannerModel?: string;
  /** The user's high-level request ("a knight finds a dragon in a misty valley"). */
  request: string;
  /** Total FINAL frames to distribute across shots. The planner sizes shots to sum to this. */
  totalFrames: number;
  signal?: AbortSignal;
}

// ───────────────────────────────────────────────────────────────────────────
// Frame validation — the VLM ("Frame Validator") layer.
//
// Sends a decoded frame to a VISION-capable gateway model and asks whether it
// matches the shot description + character bible. The gateway already accepts
// OpenAI-style `image_url` content blocks (data URIs), so no second runtime is
// shipped — same pattern as prompt expansion.
// ───────────────────────────────────────────────────────────────────────────

export type FrameIssueKind =
  | 'character-drift'
  | 'continuity'
  | 'prompt-mismatch'
  | 'artifact'
  | 'other';

export interface FrameValidationIssue {
  kind: FrameIssueKind;
  detail: string;
}

export interface FrameValidation {
  /** True when the frame is acceptable (score ≥ threshold and no blocking issue). */
  ok: boolean;
  /** 0..1 — how well the frame matches the shot + characters. */
  score: number;
  issues: FrameValidationIssue[];
}

export interface ValidateFrameOptions {
  apiKey: string;
  baseUrl?: string;
  /** Gateway model id — MUST be vision-capable. Defaults to a multimodal model. */
  validatorModel?: string;
  /** `data:image/...;base64,...` URI of the frame to validate. */
  frameDataUrl: string;
  /** The shot's prompt + action, so the VLM knows what the frame SHOULD show. */
  shotDescription: string;
  /** Character bible entries present in the shot, for drift detection. */
  characters?: { name: string; appearance: string }[];
  /** Score below which `ok` is false. Defaults to 0.6. */
  passThreshold?: number;
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

/** Per-shot validation verdict returned by `generateStoryboard` when validation
 *  is enabled — pairs a shot id with the VLM's verdict on its first keyframe. */
export interface ShotValidation {
  shotId: string;
  /** Output frame index (global across the clip) that was validated. */
  frameIndex: number;
  validation: FrameValidation;
}

export interface StoryboardGenerateOptions {
  /** The storyboard to render — usually the output of `planScene`. */
  storyboard: Storyboard;
  /** Playback framerate of the output MP4. */
  fps: number;
  /** Override denoising steps (defaults to the model's defaultSteps). */
  steps?: number;
  /** Override classifier-free-guidance scale. */
  guidance?: number;
  /** How the Mamba state biases each frame. Carried across shots for continuity. */
  coherence?: CoherenceMode;
  coherenceStrength?: number;
  /** Fresh-noise blend per frame for shots without camera motion. See GenerateOptions. */
  motionAmount?: number;
  /** Keyframe interpolation factor applied within each shot. See GenerateOptions. */
  interpolationFactor?: number;
  /** Seed base. Each shot derives a distinct seed from this. Defaults to Date.now(). */
  seed?: number;
  /** When true, run the VLM frame validator on each shot's first keyframe. */
  validate?: boolean;
  /** Vision-capable gateway model for validation. */
  validatorModel?: string;
  /** Score below which a frame validation is flagged. Defaults to 0.6. */
  passThreshold?: number;
  /** Per-frame callback (global frame index across all shots). */
  onFrame?: (frameIdx: number, bitmap: ImageBitmap, state: MambaStateSnapshot) => void;
  /** Fired when each shot finishes generating. */
  onShot?: (shotIndex: number, shot: PlannedShot, validation: FrameValidation | null) => void;
  onProgress?: (label: string) => void;
  signal?: AbortSignal;
}

export interface StoryboardGenerateResult {
  blob: Blob;
  mambaState: MambaStateSnapshot;
  frames: ImageBitmap[];
  activeDevice: ActiveDevice;
  /** The storyboard that was rendered. */
  storyboard: Storyboard;
  /** Validation verdicts, one per shot, when `validate` was true (else empty). */
  validations: ShotValidation[];
  elapsedMs: number;
}

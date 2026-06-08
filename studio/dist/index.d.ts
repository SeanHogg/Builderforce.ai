import { BuilderforceClient } from '@seanhogg/builderforce-sdk';

/**
 * Public types for @seanhogg/builderforce-studio.
 *
 * MambaStateSnapshot is the canonical shape for SSM state serialization across
 * the studio engine, the host frontend (frontend/src/lib/mamba-engine.ts), and
 * the published agent packages stored in R2. Keep this shape stable — agent
 * packages already in the wild depend on it.
 */
/** Compact snapshot of a Mamba SSM state vector, serialisable to IndexedDB / R2 / JSON. */
interface MambaStateSnapshot {
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
type DeviceTarget = 'auto' | 'webnn' | 'webgpu' | 'cpu';
/** Active hardware path the engine ended up on, reported back to the consumer. */
type ActiveDevice = 'webnn' | 'webgpu' | 'cpu';
/** Diffusion backbone. Ordered roughly smallest → largest VRAM footprint. */
type DiffusionModelId = 'lcm-tiny-sd' | 'sd-turbo' | 'lcm-dreamshaper-v7';
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
type QualityMode = 'fast' | 'balanced' | 'refined';
/** Mamba-state-driven coherence mode. */
type CoherenceMode = 'prompt-bias' | 'latent-residual';
/** Keyframe-interpolation backend. See `GenerateOptions.interpolationBackend`. */
type InterpolationBackend = 'latent-slerp' | 'motion';
/** Source for fetching model weights. The engine falls back across these in order. */
type WeightSource = 'r2-proxy' | 'huggingface-cdn';
/** A single ONNX model file, plus an optional external-data sidecar.
 *  diffusers ONNX exports >2GB split weights into a `model.onnx` graph and a
 *  `model.onnx_data` tensor blob; onnxruntime-web needs both. */
interface OnnxFile {
    /** Path within the HF repo, e.g. 'unet/model.onnx'. */
    model: string;
    /** Optional external-data sidecar, e.g. 'unet/model.onnx_data'. */
    externalData?: string;
}
interface ModelDescriptor {
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
    /** Classifier-free-guidance scale the LCM UNet was DISTILLED with — the value
     *  embedded into `timestep_cond`. This is NOT `defaultGuidance` (the runtime
     *  cond/uncond MIX scale, ~1 for LCM): LCM bakes guidance into the consistency
     *  model via this embedding, so the embedded scale must match the distillation
     *  scale (diffusers `LatentConsistencyModelPipeline` default 8.5). Embedding
     *  the mix scale instead conditions the UNet as if guidance≈1 → washed,
     *  out-of-range latents. Only meaningful when `lcmGuidanceEmbedDim` is set;
     *  defaults to `DEFAULT_LCM_GUIDANCE_SCALE` when omitted. */
    lcmGuidanceScale?: number;
}
/** Supported ONNX tensor dtypes the engine knows how to build feeds for. */
type OrtTensorDtype = 'float32' | 'int32' | 'int64';
/** A single ORT session input — name (as declared in the model graph) + the
 *  tensor dtype ORT will accept for it. Wrong dtype → "Unexpected input data
 *  type" at runtime; the registry-contract test catches misdeclaration. */
interface OrtInputSpec {
    name: string;
    dtype: OrtTensorDtype;
}
interface VideoEngineOptions {
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
interface GenerateOptions {
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
     * Per-frame camera transform applied to the prior latent BEFORE re-noising.
     * `dx`/`dy` are a directional shift in latent-pixel units (1 latent pixel =
     * 8 output pixels via the VAE down-factor): dy=-1 looks like the camera
     * tilting up; dx=1 looks like the world panning right (camera moving left).
     * `zoom` is a center-anchored scale (dolly): >1 pushes in, <1 pulls out,
     * omitted/1 = no zoom. Only consulted when `imgToImgStrength > 0`. Default
     * omitted = no transform.
     */
    cameraMotion?: {
        dx: number;
        dy: number;
        zoom?: number;
    };
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
    /**
     * Which interpolation backend fills the frames between keyframes (only used
     * when `interpolationFactor > 1`):
     *   'latent-slerp' (default) → spherical interp of the two keyframe latents +
     *      one VAE decode. Smooth, but a morph — no notion of motion.
     *   'motion' → block optical-flow estimate between the decoded keyframes,
     *      then motion-compensated warp. Real displacement (a panning subject
     *      slides), at the cost of an extra decode per keyframe + the flow search.
     */
    interpolationBackend?: InterpolationBackend;
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
/**
 * One character's LOCKED visual description. The same `appearance` string is
 * appended to every shot prompt the character appears in, so the diffusion
 * model paints a consistent subject across shots (the feedback's "Character
 * Agent" — consistency is achieved by threading this descriptor, not by asking
 * the image model to "remember").
 */
interface CharacterBible {
    /** Stable id referenced by `PlannedShot.characterIds`, e.g. "char-1". */
    id: string;
    name: string;
    /** Diffusion-ready appearance descriptor: age, build, hair, wardrobe, palette. */
    appearance: string;
}
/** Canonical camera moves the planner may request. Mapped to a latent-space
 *  pan/tilt (`cameraMotion` dx/dy) + an img2img strength by `cameraMoveToMotion`. */
type CameraMove = 'static' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down' | 'dolly-in' | 'dolly-out';
/** One shot in a storyboard — a continuous run of frames sharing a prompt. */
interface PlannedShot {
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
interface Storyboard {
    /** One-paragraph treatment: tone, arc, setting. The Director agent's output. */
    treatment: string;
    characters: CharacterBible[];
    shots: PlannedShot[];
}
interface ScenePlanOptions {
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
type FrameIssueKind = 'character-drift' | 'continuity' | 'prompt-mismatch' | 'artifact' | 'other';
interface FrameValidationIssue {
    kind: FrameIssueKind;
    detail: string;
}
interface FrameValidation {
    /** True when the frame is acceptable (score ≥ threshold and no blocking issue). */
    ok: boolean;
    /** 0..1 — how well the frame matches the shot + characters. */
    score: number;
    issues: FrameValidationIssue[];
}
interface ValidateFrameOptions {
    apiKey: string;
    baseUrl?: string;
    /** Gateway model id — MUST be vision-capable. Defaults to a multimodal model. */
    validatorModel?: string;
    /** `data:image/...;base64,...` URI of the frame to validate. */
    frameDataUrl: string;
    /** The shot's prompt + action, so the VLM knows what the frame SHOULD show. */
    shotDescription: string;
    /** Character bible entries present in the shot, for drift detection. */
    characters?: {
        name: string;
        appearance: string;
    }[];
    /** Score below which `ok` is false. Defaults to 0.6. */
    passThreshold?: number;
    signal?: AbortSignal;
}
interface GenerateResult {
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
interface ShotValidation {
    shotId: string;
    /** Output frame index (global across the clip) that was validated. */
    frameIndex: number;
    validation: FrameValidation;
}
interface StoryboardGenerateOptions {
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
    /** Interpolation backend for the tween frames. See GenerateOptions. */
    interpolationBackend?: InterpolationBackend;
    /** Seed base. Each shot derives a distinct seed from this. Defaults to Date.now(). */
    seed?: number;
    /** When true, run the VLM frame validator on each shot's first + last keyframe. */
    validate?: boolean;
    /** Vision-capable gateway model for validation. */
    validatorModel?: string;
    /** Score below which a frame validation is flagged. Defaults to 0.6. */
    passThreshold?: number;
    /**
     * Self-healing: when `validate` is on and a shot's validation fails, re-render
     * it with a fresh seed up to this many times, keeping the highest-scoring
     * attempt. 0 = validate but never retry (advisory only). Defaults to 1.
     */
    maxValidationRetries?: number;
    /** Per-frame callback (global frame index across all shots). */
    onFrame?: (frameIdx: number, bitmap: ImageBitmap, state: MambaStateSnapshot) => void;
    /** Fired when each shot finishes generating. */
    onShot?: (shotIndex: number, shot: PlannedShot, validation: FrameValidation | null) => void;
    onProgress?: (label: string) => void;
    signal?: AbortSignal;
}
interface StoryboardGenerateResult {
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

/**
 * VideoEngine — public orchestrator for end-to-end client-side video generation.
 *
 * Flow (matches the user's "Brain → Artist → Output" spec, all client-side):
 *
 *   1. expandPrompt()           → Builderforce LLM gateway rewrites the short prompt
 *   2. embedPrompt()            → CLIP text encoder produces the conditioning embedding
 *   3. per-frame loop:
 *        a. sampleInitialLatent() seeded from frame index
 *        b. mamba-coherence applies state to prompt OR latent
 *        c. denoise() runs the shared LCM/SD-Turbo primitive
 *        d. pixelsToRgba() converts to displayable RGBA
 *        e. advanceState() updates the Mamba state from this frame's output
 *   4. muxFramesToMp4()         → WebCodecs encodes the frames to MP4
 *
 * `VideoEngine.create()` is the only construction path — it probes the device,
 * downloads weights, initialises ONNX sessions, and returns null when the
 * environment cannot run the pipeline. The consumer never computes its own
 * "can this device run?" check (DRY).
 */

declare class VideoEngine {
    private readonly opts;
    private diffusion;
    private mambaState;
    readonly activeDevice: ActiveDevice;
    /** Track the probed device so we can lazy-create a refinement-pass engine
     *  later with the same hardware target — needed for the two-pass quality
     *  chain (draft model → dispose → refinement model). */
    private readonly probed;
    private constructor();
    /**
     * Construct an engine bound to the host's best available hardware. Returns
     * `null` when no device path is viable — the consumer should render an
     * unsupported state rather than try to recover.
     */
    static create(options: VideoEngineOptions): Promise<VideoEngine | null>;
    /**
     * Generate one video clip. Per-keyframe work is sequential (keyframes depend
     * on the previous keyframe's Mamba state). With `interpolationFactor > 1`,
     * only keyframes run the diffusion denoise loop and the frames between them
     * are slerp-interpolated in latent space (one cheap VAE decode each). Returns
     * the muxed MP4 plus the updated state.
     */
    generate(args: GenerateOptions): Promise<GenerateResult>;
    /**
     * Render a full storyboard (the Director / Shot-Planner output) into one MP4.
     * Each shot is generated as its own clip — the shot's composed prompt (shot
     * text + locked character appearances) is embedded fresh, the camera move is
     * mapped to latent motion + img2img recursion, and the Mamba state is carried
     * ACROSS shots so the SSM memory threads continuity through the whole scene.
     * When `validate` is set, each shot's first keyframe is checked by the VLM
     * frame validator (advisory — never blocks generation).
     */
    generateStoryboard(args: StoryboardGenerateOptions): Promise<StoryboardGenerateResult>;
    /**
     * Render one storyboard shot, with self-healing validation retries. Generates
     * the clip, validates its first + last keyframe, and — if validation fails and
     * retries remain — re-renders with a fresh seed, keeping the highest-scoring
     * attempt. The Mamba state is snapshotted before each attempt and restored, so
     * a discarded attempt doesn't pollute cross-shot continuity; the kept
     * attempt's state is committed on return.
     */
    private renderShot;
    /**
     * Generate the frames for one clip. Keyframes (every `interpolationFactor`-th
     * output frame, with index 0 and the last index pinned) run the full denoise
     * loop; the frames between them are slerp-interpolated in latent space and
     * decoded once each. Advances `this.mambaState` per keyframe. Returns frames
     * in OUTPUT ORDER plus each frame's clean latent (for the refinement pass).
     *
     * Encapsulates the anchor-walk / img2img-recursion / camera-motion / Mamba
     * logic shared by `generate` and `generateStoryboard` — single source of
     * truth for "how one frame is made".
     */
    private produceClip;
    /**
     * Second pass over an already-produced clip through a different (usually
     * larger) model. Disposes the draft engine, loads the refinement engine, and
     * for each frame WITH a true latent re-noises it to a partial timestep and
     * finishes the denoise. Frames with a `null` latent (motion-backend tweens)
     * are carried through UNCHANGED — refining them from a stand-in latent would
     * discard their optical-flow warp. Sequential load → VRAM stays at
     * max(draft, refinement). Only safe across SD1.5-family models.
     *
     * Owns the lifecycle of the draft clip's bitmaps: refined frames replace and
     * CLOSE their drafts; carried-through frames are reused (not closed). The
     * caller must NOT close the draft clip afterwards.
     */
    private refinementPass;
    /**
     * Validate a shot through the VLM by checking its FIRST and LAST keyframe
     * (mid-shot drift is invisible to a single-frame check). Returns the merged
     * verdict: `ok` only if both ends pass, `score` is the worse of the two, and
     * issues are concatenated. Returns null when validation can't run at all (no
     * OffscreenCanvas / both calls failed) so the caller treats it as advisory.
     */
    private validateShot;
    /**
     * Validate ONE frame of a shot through the VLM. Encodes the raw RGBA to a
     * JPEG data URL (via OffscreenCanvas) and asks the gateway's vision model
     * whether it matches the shot + character bible. Advisory: any failure
     * (no OffscreenCanvas, gateway down) returns null.
     */
    private validateOneFrame;
    /** Read the current Mamba state without mutating the engine — for persistence. */
    getMambaState(): MambaStateSnapshot;
    /** Replace the Mamba state — used when resuming a session from R2 / IDB. */
    setMambaState(state: MambaStateSnapshot): void;
    /** Release ORT sessions + GPUDevice. Idempotent. After dispose the engine
     *  cannot be reused — create a new one with VideoEngine.create. */
    dispose(): Promise<void>;
}

/**
 * Device router — the canonical place to ask "can this browser run the studio?"
 *
 * Probes WebNN → WebGPU → CPU and returns the first path that initialises with
 * an actual usable device. The studio's React panel and engine both call this;
 * consumers never compute `hasWebGPU` themselves (DRY: shared decision lives
 * here, not in prop-drilled booleans).
 *
 * Returning `null` from `probeDevice` is the package's signal that the host
 * environment cannot run the studio at all — the StudioPanel renders an
 * unsupported state and the engine refuses to construct.
 */

interface ProbedDevice {
    kind: ActiveDevice;
    /** Present when kind === 'webgpu'. Owned by the studio engine after probe. */
    gpuDevice?: GPUDevice;
    /** Present when kind === 'webnn'. Same lifetime ownership. */
    mlContext?: unknown;
    /** Human-readable label for telemetry / UI ("NVIDIA GeForce RTX 4090", "Snapdragon X NPU", etc.). */
    label: string;
    /** Best-effort VRAM / unified-memory headroom in MB, or null when not exposed. */
    approxMemoryMb: number | null;
}
/**
 * Synchronous WebGPU-availability check. Returns true when the browser exposes
 * `navigator.gpu` — does NOT request an adapter, so it's safe to call during
 * render. Consumers that need the actual device should `await probeDevice('webgpu')`.
 */
declare function hasWebGPUSupport(): boolean;
/**
 * Probe in priority order. Pass an explicit `target` to force one path
 * (useful for tests and for the StudioPanel's "force CPU" advanced toggle).
 *
 * Returns null when nothing is reachable. The package's downstream code
 * checks this and renders / throws an unsupported state.
 */
declare function probeDevice(target?: DeviceTarget): Promise<ProbedDevice | null>;

/**
 * DiffusionEngine — hybrid ORT + transformers.js denoising pipeline.
 *
 * Layered architecture:
 *   • transformers.js (extension layer) — owns the CLIP BPE tokenizer + the
 *     text-encoder ONNX session. We do NOT hand-roll BPE.
 *   • raw onnxruntime-web (base layer) — owns the UNet + VAE-decoder sessions.
 *     We keep direct control here so Mamba latent-residual coherence can
 *     inject biases between scheduler steps without going through an opaque
 *     pipeline wrapper.
 *
 * The shared denoise() primitive runs an LCM-style consistency-model step
 * that works for both backbones — SD-Turbo with timesteps=[999] degrades to
 * the standard single-step formulation, LCM with timesteps=[999,759,519,259]
 * uses the same formula 4× with the right alpha schedule.
 */

declare const MODEL_REGISTRY: Record<DiffusionModelId, ModelDescriptor>;

/**
 * Single source of truth for ONNX Runtime configuration across the host app.
 *
 * Two ONNX runtimes coexist in the browser process:
 *   - `onnxruntime-web` (raw) — owns text-encoder + UNet + VAE sessions.
 *   - `@huggingface/transformers` — bundles its own ORT instance (unused by
 *     this engine, which only uses transformers.js for pure-JS tokenization,
 *     but configured here for safety).
 *
 * Both need identical `wasm.wasmPaths` + `wasm.numThreads`. Setting them in one
 * place avoids the "configured here but not there" trap.
 *
 * The WASM files load from a CDN — they would otherwise add ~25 MiB to the
 * Cloudflare deploy (per-asset limit is 25 MiB; the JSEP variant is at the
 * limit). CRITICAL: the CDN version MUST match the installed onnxruntime-web
 * JS version, or the WASM/JS ABI mismatches and you get errors like
 * `_OrtGetInputOutputMetadata is not a function`. So the default CDN URL is
 * derived from `ort.env.versions.common` at runtime, not hardcoded.
 */
interface OnnxRuntimeConfigOptions {
    /** Override the CDN base URL for ORT WASM files. Default: jsdelivr pinned to the
     *  installed onnxruntime-web version so WASM and JS ABIs match. */
    wasmCdn?: string;
    /** Override the thread count. Default: 1 (browser COOP/COEP isolation overhead is not worth it). */
    numThreads?: number;
}
/**
 * Idempotent. Safe to call from multiple modules — only the first call applies;
 * subsequent calls noop. Both bundled ORT instances share the resulting config.
 */
declare function configureOnnxRuntime(opts?: OnnxRuntimeConfigOptions): void;

/**
 * ScenePlanner — the Director / Storyboard / Character / Shot-Planner layer.
 *
 * Turns ONE high-level user request into a typed `Storyboard` the video engine
 * can execute. The feedback's pipeline:
 *
 *     User Request → Director → Storyboard → Character → Shot Planner → ...
 *
 * is implemented as two structured gateway calls that share the storyboard as
 * their memory bus:
 *
 *   1. directorPass()  — request → { treatment, characters }   (the Director +
 *                        Character Bible: tone/arc/setting + locked character
 *                        appearances for cross-shot consistency).
 *   2. shotPlannerPass()— (treatment + characters) → shots[]    (the Storyboard
 *                        + Shot Planner: each shot's diffusion prompt, camera
 *                        move, action, and frame budget).
 *
 * Both calls use the gateway's `response_format: json_schema` so the model is
 * forced to return parseable structured output (gateway-side retry on schema
 * miss). We DON'T ship a browser LLM — the gateway already runs the failover
 * cascade, same rationale as `llm-bridge.ts`.
 *
 * The reasoning LLM never paints pixels and the diffusion model never sees the
 * raw request — exactly the separation the feedback asked for.
 */

/** The canonical camera-move vocabulary. Exported so UIs (the storyboard
 *  editor) offer exactly the moves the planner + engine understand. */
declare const CAMERA_MOVES: readonly CameraMove[];
/** Parsed shape of the director call (pre-validation). */
interface DirectorOut {
    treatment: string;
    characters: CharacterBible[];
}
interface ShotPlannerOut {
    shots: PlannedShot[];
}
/**
 * Run the full two-pass planning pipeline. Returns a `Storyboard` whose shot
 * `durationFrames` are normalised to sum EXACTLY to `opts.totalFrames` (the LLM
 * is asked to hit the total but rarely lands on it precisely; the engine needs
 * an exact budget). Inject `client` in tests; production constructs its own.
 */
declare function planScene(opts: ScenePlanOptions, client?: BuilderforceClient): Promise<Storyboard>;
/** Director + Character Bible pass. */
declare function directorPass(client: BuilderforceClient, model: string, opts: ScenePlanOptions): Promise<DirectorOut>;
/** Storyboard + Shot Planner pass. */
declare function shotPlannerPass(client: BuilderforceClient, model: string, opts: ScenePlanOptions, director: DirectorOut): Promise<ShotPlannerOut>;
/**
 * Map a planned camera move to the engine's motion knobs. Camera motion in the
 * engine is a latent-space pan/tilt/zoom fed into img2img recursion, so a move
 * implies BOTH a transform AND a non-zero img2img strength (otherwise the
 * transform has no recursion path to ride on). `static` → no motion.
 *
 * dx/dy are in latent pixels (1 = 8 output px). `zoom` is a per-keyframe scale
 * factor applied about the frame centre: >1 pushes in (dolly-in), <1 pulls out
 * (dolly-out). 1.04 ≈ a 4 %/keyframe push, gentle enough that img2img can keep
 * the scene coherent while still reading as a dolly.
 */
declare function cameraMoveToMotion(move: CameraMove): {
    cameraMotion?: {
        dx: number;
        dy: number;
        zoom?: number;
    };
    imgToImgStrength: number;
};
/**
 * Compose the final diffusion prompt for a shot: the shot prompt plus the
 * locked appearance of every referenced character. Single source of truth for
 * "what text the diffusion model actually sees" so consistency can't drift
 * between the validator and the generator.
 */
declare function composeShotPrompt(shot: PlannedShot, characters: CharacterBible[]): string;
/**
 * Total FINAL frame count a storyboard renders — the sum of every shot's
 * `durationFrames`. Single source of truth for "how many frames will this
 * storyboard produce", so the editor's "N shots · M frames" label and the
 * progress bar's denominator can't drift from each other (or from the actual
 * number of `onFrame` callbacks the engine emits). In cinematic mode this — NOT
 * the single-clip `frames` input — is the real total.
 */
declare function storyboardFrameCount(storyboard: Storyboard): number;
/**
 * Force the shot frame budgets to sum to exactly `total`. The LLM's per-shot
 * counts are treated as PROPORTIONS; we rescale them and fix rounding drift on
 * the last shot so the engine gets a precise, non-zero budget per shot.
 *
 * Falls back to a single synthetic shot if the planner returned none — the
 * caller always gets an executable storyboard.
 */
declare function normaliseShotBudget(shots: PlannedShot[], total: number): PlannedShot[];

/**
 * FrameValidator — the VLM ("Frame Validator") layer.
 *
 * After a frame is generated, send it to a VISION-capable gateway model and ask
 * whether it matches the shot description + character bible. This is the
 * feedback's consistency/continuity check: catch character drift (wrong hair,
 * wardrobe), prompt mismatch, and obvious diffusion artifacts before they ship
 * in the final clip.
 *
 * No second runtime: the Builderforce gateway accepts OpenAI-style `image_url`
 * content blocks (data URIs), so we pass the decoded frame as a `data:image/...`
 * URL alongside the question — exactly like a multimodal chat turn. Same
 * gateway-failover + budget story as prompt expansion and scene planning.
 *
 * The model is asked for a structured verdict (json_schema) so we get a numeric
 * score + typed issues, not prose. `ok` is derived from the score vs a
 * threshold so the caller has one boolean to gate on.
 */

/**
 * Validate one frame against its shot. Returns a verdict with `ok` derived from
 * `score >= passThreshold`. On any gateway/parse failure returns a permissive
 * `ok: true` verdict (score 1) — the validator is an ADVISORY quality gate, not
 * a hard dependency; a validator outage must not block video generation.
 * Inject `client` in tests; production constructs its own.
 */
declare function validateFrame(opts: ValidateFrameOptions, client?: BuilderforceClient): Promise<FrameValidation>;

/**
 * FrameInterpolator — keyframe → in-between generation in VAE latent space.
 *
 * The expensive part of diffusion video is the UNet denoise loop, run once per
 * frame. The feedback's key insight: don't run it per frame. Generate sparse
 * KEYFRAMES with the full denoise loop, then synthesize the frames between them
 * cheaply. Here "cheaply" = spherical-linear interpolation (slerp) of the two
 * neighbouring clean latents, followed by a single VAE decode per tween.
 *
 * Why slerp and not linear (lerp): diffusion latents live on (approximately) a
 * hypersphere — they're high-dimensional near-unit-norm Gaussian-ish vectors.
 * Linear interpolation cuts a chord through the sphere, shrinking the norm at
 * the midpoint (||0.5a + 0.5b|| < 1), which decodes to a washed-out, low-
 * contrast tween. Slerp walks the great-circle arc, preserving norm, so the
 * tween decodes at the same fidelity as its keyframes. This is the same reason
 * latent-space image-morph demos use slerp.
 *
 * This module is pure (no ORT, no network) so it is fully unit-tested. The VAE
 * decode of each interpolated latent is the engine's job (DiffusionEngine.
 * decodeLatent) — keeping the math here separable from the GPU work.
 *
 * A true optical-flow interpolator (RIFE / FILM) would produce physically
 * correct motion rather than latent morph; that needs a separate ONNX model +
 * session and is logged in the Consolidated Gap Register. Latent slerp ships
 * today with zero extra weights.
 */
/**
 * Spherical-linear interpolation between two equal-length vectors at fraction
 * `t` ∈ [0, 1]. `t = 0` → exactly `a`, `t = 1` → exactly `b`. Falls back to
 * linear interpolation when the two vectors are nearly collinear (the arc is
 * degenerate and slerp's `sin(theta)` denominator → 0).
 */
declare function slerp(a: Float32Array, b: Float32Array, t: number): Float32Array;
/**
 * Decide which FINAL frame indices are generated as keyframes (full denoise)
 * given the desired total and an interpolation factor. The remaining indices
 * are filled by interpolation.
 *
 * Contract:
 *   • index 0 is ALWAYS a keyframe.
 *   • the LAST index is ALWAYS a keyframe (so the clip ends on real content,
 *     not a tween extrapolated past the final keyframe).
 *   • interior keyframes are spaced ~`factor` apart.
 *
 * Examples (totalFrames, factor) → indices:
 *   (8, 2) → [0, 2, 4, 6, 7]   (every other, last pinned)
 *   (9, 4) → [0, 4, 8]
 *   (5, 1) → [0, 1, 2, 3, 4]   (factor 1 = every frame is a keyframe)
 */
declare function planKeyframeIndices(totalFrames: number, factor: number): number[];
/** A keyframe paired with the FINAL output index it occupies. */
interface Keyframe {
    /** Position in the final frame sequence (from `planKeyframeIndices`). */
    outputIndex: number;
    /** The keyframe's clean (post-denoise) latent — the slerp endpoints. */
    latent: Float32Array;
}
/** One frame slot in the fully-expanded sequence: either an existing keyframe
 *  (already decoded by the engine) or a tween latent the engine must decode. */
interface InterpolatedSlot {
    outputIndex: number;
    /** When true, `latent` is a freshly-slerped tween that needs a VAE decode.
     *  When false, this slot is a keyframe the engine already decoded. */
    isTween: boolean;
    /** Index into the ORIGINAL keyframe array — set only for keyframe slots so
     *  the engine can reuse the already-decoded pixels instead of re-decoding. */
    keyframeIndex?: number;
    /** The latent for tween slots (slerp result). Undefined for keyframe slots. */
    latent?: Float32Array;
}
/**
 * Expand a sparse keyframe list into the full ordered frame sequence, emitting
 * a slerped tween latent for every gap index. The engine then decodes only the
 * tween latents (keyframes are already decoded), assembling the final clip.
 *
 * Keyframes MUST be sorted ascending by `outputIndex` and the first must be
 * index 0. The fraction for a tween at output index `x` between keyframes at
 * `k0` and `k1` is `(x - k0) / (k1 - k0)` — evenly spaced in output time.
 */
declare function buildInterpolatedSequence(keyframes: Keyframe[]): InterpolatedSlot[];

/**
 * MotionInterpolator — motion-compensated frame interpolation (block optical
 * flow) in PIXEL space. The alternative to the latent-slerp backend.
 *
 * Latent slerp morphs one keyframe into the next; it has no notion of *motion*,
 * so a fast pan reads as a cross-dissolve. This backend instead estimates a
 * per-block motion field between two decoded keyframes, then synthesises a tween
 * by bidirectionally warping both keyframes along that motion and blending — the
 * same principle a learned model (RIFE/FILM) uses, minus the learned flow.
 *
 * The estimator is COARSE-TO-FINE with SUB-PIXEL refinement:
 *   1. a downscaled (coarse) full search captures large motion cheaply — a
 *      ±searchRadius search on a /F plane covers ±searchRadius·F full-res pixels,
 *      so fast pans that a single-level small search would miss are recovered;
 *   2. a small full-resolution search around the upscaled coarse prediction
 *      locks the integer vector precisely;
 *   3. a parabolic fit of the SAD around that minimum yields a SUB-PIXEL offset,
 *      so the warp slides smoothly instead of snapping to whole pixels.
 *
 * Pure (no ORT, no network) so it's fully unit-tested. Works on the engine's RGB
 * pixel layout: planar Float32 `[3, H, W]`, range [-1..1]. A learned RIFE/FILM
 * ONNX backend could replace `estimateBlockMotion` behind the same
 * `interpolateFrames` signature later — tracked in the Consolidated Gap Register.
 */
/** Per-block motion field: `vec[2*i]` = dx, `vec[2*i+1]` = dy for block i
 *  (row-major). Sub-pixel, so values are fractional. */
interface MotionField {
    blockSize: number;
    cols: number;
    rows: number;
    /** Interleaved sub-pixel (dx, dy) per block, in full-res pixels (A → B). */
    vec: Float32Array;
}
interface MotionOptions {
    /** Block edge in pixels. Larger = faster + smoother, less detail. Default 16. */
    blockSize?: number;
    /** Max per-axis search displacement, in COARSE-level pixels. The effective
     *  full-res reach is `searchRadius · 2^(levels-1)`. Default 8. */
    searchRadius?: number;
    /** Pyramid levels. 1 = single full-res search (no coarse stage); 3 = /4 coarse
     *  prediction then full-res refine. Default 3. */
    levels?: number;
}
/** Extract a luma (BT.601-ish) plane from planar RGB [-1..1]. Single source of
 *  truth for the "what we match motion on" decision. */
declare function luma(rgb: Float32Array, width: number, height: number): Float32Array;
/**
 * Estimate an A→B block motion field, coarse-to-fine with sub-pixel refinement.
 * Cheap relative to a full denoise; deterministic.
 */
declare function estimateBlockMotion(a: Float32Array, b: Float32Array, width: number, height: number, opts?: MotionOptions): MotionField;
/**
 * Synthesise the frame at fraction `t` ∈ (0,1) between keyframes `a` and `b`
 * using motion-compensated bidirectional warping:
 *
 *   out(x) = (1-t)·A(x − t·mv) + t·B(x + (1−t)·mv)
 *
 * where `mv` is the block's A→B displacement. At t=0 this is A, at t=1 it's B;
 * in between, the subject is sampled from where it physically was at time t, so
 * it slides rather than fades.
 */
declare function interpolateFrames(a: Float32Array, b: Float32Array, width: number, height: number, t: number, field: MotionField): Float32Array;

export { type ActiveDevice, CAMERA_MOVES, type CameraMove, type CharacterBible, type CoherenceMode, type DeviceTarget, type DiffusionModelId, type FrameIssueKind, type FrameValidation, type FrameValidationIssue, type GenerateOptions, type GenerateResult, type InterpolatedSlot, type InterpolationBackend, type Keyframe, MODEL_REGISTRY, type MambaStateSnapshot, type ModelDescriptor, type MotionField, type MotionOptions, type OnnxFile, type OnnxRuntimeConfigOptions, type OrtInputSpec, type OrtTensorDtype, type PlannedShot, type ProbedDevice, type QualityMode, type ScenePlanOptions, type ShotValidation, type Storyboard, type StoryboardGenerateOptions, type StoryboardGenerateResult, type ValidateFrameOptions, VideoEngine, type VideoEngineOptions, type WeightSource, buildInterpolatedSequence, cameraMoveToMotion, composeShotPrompt, configureOnnxRuntime, directorPass, estimateBlockMotion, hasWebGPUSupport, interpolateFrames, luma, normaliseShotBudget, planKeyframeIndices, planScene, probeDevice, shotPlannerPass, slerp, storyboardFrameCount, validateFrame };

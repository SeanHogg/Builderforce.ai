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
/** Diffusion backbone. */
type DiffusionModelId = 'lcm-dreamshaper-v7' | 'sd-turbo';
/** Mamba-state-driven coherence mode. */
type CoherenceMode = 'prompt-bias' | 'latent-residual';
/** Source for fetching model weights. The engine falls back across these in order. */
type WeightSource = 'r2-proxy' | 'huggingface-cdn';
interface ModelDescriptor {
    id: DiffusionModelId;
    /** Number of denoising steps. LCM = 4, SD-Turbo = 1. */
    defaultSteps: number;
    /** Default classifier-free-guidance scale. */
    defaultGuidance: number;
    /** Minimum advertised VRAM in MB. The engine warns below this. */
    minVramMb: number;
    /** Hugging Face repo id used both for the transformers.js tokenizer/text-encoder
     *  pull and for the raw-ORT UNet/VAE weight fetch through weight-cache.ts. */
    hfRepo: string;
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
        unet: string;
        vaeDecoder: string;
    };
}
interface VideoEngineOptions {
    /** Builderforce API key. Used to call the LLM gateway for prompt expansion. */
    apiKey: string;
    /** Builderforce gateway base URL. Defaults to https://api.builderforce.ai. */
    baseUrl?: string;
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
    /** Called once per finished frame. */
    onFrame?: (frameIdx: number, bitmap: ImageBitmap, state: MambaStateSnapshot) => void;
    /** Called when prompt expansion finishes (before diffusion starts). */
    onPromptExpanded?: (expanded: string) => void;
    /** AbortSignal for cancelling generation mid-flight. */
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
    private readonly diffusion;
    private mambaState;
    readonly activeDevice: ActiveDevice;
    private constructor();
    /**
     * Construct an engine bound to the host's best available hardware. Returns
     * `null` when no device path is viable — the consumer should render an
     * unsupported state rather than try to recover.
     */
    static create(options: VideoEngineOptions): Promise<VideoEngine | null>;
    /**
     * Generate one video clip. Per-frame work is sequential (frames depend on
     * the previous frame's Mamba state). Returns the muxed MP4 plus the updated
     * state — caller can persist the state for follow-up generations.
     */
    generate(args: GenerateOptions): Promise<GenerateResult>;
    /** Read the current Mamba state without mutating the engine — for persistence. */
    getMambaState(): MambaStateSnapshot;
    /** Replace the Mamba state — used when resuming a session from R2 / IDB. */
    setMambaState(state: MambaStateSnapshot): void;
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
 * `navigator.gpu` — does NOT actually request an adapter, so it's safe to call
 * during render. Consumers that need the actual device should `await probeDevice('webgpu')`.
 *
 * This is the single sync probe — frontend's previous `isWebGPUAvailable` /
 * `isMambaWebGPUAvailable` / `requestWebGPUDevice` all collapse to this plus
 * `probeDevice('webgpu')`.
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

export { type ActiveDevice as A, type CoherenceMode as C, type DeviceTarget as D, type GenerateOptions as G, MODEL_REGISTRY as M, type ProbedDevice as P, VideoEngine as V, type WeightSource as W, type DiffusionModelId as a, type GenerateResult as b, type MambaStateSnapshot as c, type ModelDescriptor as d, type VideoEngineOptions as e, hasWebGPUSupport as h, probeDevice as p };

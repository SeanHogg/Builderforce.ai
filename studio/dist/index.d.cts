import { A as ActiveDevice, V as VideoEngineOptions, G as GenerateOptions, a as GenerateResult, S as StoryboardGenerateOptions, b as StoryboardGenerateResult, M as MambaStateSnapshot, D as DiffusionModelId, c as ModelDescriptor, C as CameraMove, P as PlannedShot, d as CharacterBible, e as ScenePlanOptions, f as Storyboard, g as ValidateFrameOptions, F as FrameValidation } from './device-router-Ct4N7PTF.cjs';
export { h as CoherenceMode, i as DeviceTarget, j as FrameIssueKind, k as FrameValidationIssue, I as InterpolationBackend, L as LcmModelDescriptor, l as LcmModelId, O as OnnxFile, m as OrtInputSpec, n as OrtTensorDtype, o as ProbedDevice, Q as QualityMode, p as ShotValidation, W as WebDitModelDescriptor, q as WebDitModelId, r as WeightSource, s as hasWebGPUSupport, t as probeDevice } from './device-router-Ct4N7PTF.cjs';
import { BuilderforceClient } from '@seanhogg/builderforce-sdk';
import '@webdit/shared';

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
    /** Which generation family this instance was constructed for — set once
     *  here so `generate()`/`generateStoryboard()` dispatch without
     *  re-deriving it from `MODEL_REGISTRY` on every call. */
    private readonly engineKind;
    private readonly webditBundle;
    /** Track the probed device so we can lazy-create a refinement-pass engine
     *  later with the same hardware target — needed for the two-pass quality
     *  chain (draft model → dispose → refinement model). Only meaningful on
     *  the lcm-diffusion path (refinement across engine families is rejected
     *  in `create()` before either engine is constructed). */
    private readonly probed;
    private constructor();
    /**
     * Construct an engine bound to the host's best available hardware. Returns
     * `null` when no device path is viable — the consumer should render an
     * unsupported state rather than try to recover.
     */
    static create(options: VideoEngineOptions): Promise<VideoEngine | null>;
    /**
     * webdit-dit construction path. webdit's ORT execution is WebGPU-only (no
     * CPU/WebNN fallback exists in `@webdit/runtime`), so this probes WebGPU
     * specifically rather than `options.device ?? 'auto'`. Returns `null` (the
     * same "consumer never computes its own can-run check" contract as the
     * lcm-diffusion path) both when WebGPU is unavailable AND when the model
     * has no bundle to load yet (`available: false` / `bundleUrl: null` — the
     * expected state for all 4 webdit models until an operator uploads a real
     * bundle; see the ROADMAP entry).
     */
    private static createWebDit;
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
     * webdit-dit storyboard rendering. Each shot is generated independently via
     * `runWebDitDenoise` (no cross-shot Mamba carry — webdit's DiT models are
     * video-native and already model temporal coherence WITHIN a shot; the
     * lcm-diffusion path's cross-shot continuity mechanism, threading Mamba
     * state through `cameraMotion`/img2img recursion, is specific to that
     * per-frame pipeline and has no webdit equivalent), then every shot's
     * frames are concatenated in shot order and muxed ONCE at the end — the
     * same overall "loop shots, concat, mux once" shape as the lcm-diffusion
     * path above, just without the two-pass refinement or per-shot VLM
     * validation retry loop (out of scope here: `refinementModel` across
     * engine families is rejected in `create()`, and validation is an
     * lcm-diffusion-specific advisory feature — `validations` is always empty
     * on this path).
     */
    private generateWebDitStoryboard;
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
    /** Release ORT sessions + GPUDevice (lcm-diffusion) or unload the webdit
     *  bundle (webdit-dit) — whichever this instance holds. Idempotent. After
     *  dispose the engine cannot be reused — create a new one with
     *  VideoEngine.create. */
    dispose(): Promise<void>;
    /**
     * Non-null accessor for the lcm-diffusion engine. Every internal caller of
     * this getter (produceClip, refinementPass, renderShot, the lcm branches of
     * generate()/generateStoryboard()) is itself only reachable via the
     * lcm-diffusion branch of create()/generate() — a throw here means an
     * internal dispatch bug, not a reachable user state.
     */
    private get lcmDiffusion();
}

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
 * caller always gets an executable storyboard. `fallbackPrompt` (the user's raw
 * request) becomes that shot's diffusion prompt, so a DEGRADED plan — gateway
 * unreachable, planner returned nothing — still renders the scene the user asked
 * for instead of an empty prompt.
 */
declare function normaliseShotBudget(shots: PlannedShot[], total: number, fallbackPrompt?: string): PlannedShot[];

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

interface MelConfig {
    sampleRate: number;
    frameLength: number;
    hopLength: number;
    numMels: number;
}
interface MelSpectrogram {
    /** One log-mel vector (length `numMels`) per analysis frame. */
    frames: Float32Array[];
    numMels: number;
    hopLength: number;
    frameLength: number;
    sampleRate: number;
}
/** PCM waveform → log-mel spectrogram. The single entry point both the speaker
 *  encoder and the codec analysis path call. */
declare function melSpectrogram(pcm: Float32Array, overrides?: Partial<MelConfig>): MelSpectrogram;
/**
 * Mel spectrogram → PCM waveform (the vocoder inversion the acoustic model's
 * output rides through).
 *
 * This is an honest, deterministic, weight-free inversion — NOT a trained neural
 * vocoder. Steps: undo the log; map mel energies back to a linear magnitude
 * spectrum through the transposed filterbank; pair the magnitude with a
 * zero-phase spectrum; inverse-FFT each frame; overlap-add with the synthesis
 * window. It reconstructs pitch/formant structure (so a cloned timbre is
 * audibly present and round-trips in tests) but is band-limited and phase-naive
 * compared to a trained HiFi-GAN. Phase 2's training pipeline replaces this body
 * with learned vocoder weights behind the same signature — logged in the Gap
 * Register, not hidden.
 */
declare function melToWaveform(mel: MelSpectrogram): Float32Array;
/** Cosine similarity of two equal-length vectors. Shared by speaker-identity
 *  verification and codebook nearest-neighbour search. */
declare function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number;

/**
 * Public types for the studio voice-cloning stack (Phase 1 + Phase 2).
 *
 * The pipeline is: reference PCM ──speaker-encoder──▶ SpeakerEmbedding, and
 * text ──tokenizer──▶ tokens ──SSM acoustic model (conditioned on the
 * embedding)──▶ CodecTokens ──neural-codec.decode──▶ PCM. CloneSynthesisResult
 * is deliberately shaped to match the server's `studio_voiceovers` row
 * (audio + wordTimestamps + durationMs) so cloned audio flows into captions,
 * the AvatarWidget, and the timeline with zero new plumbing.
 */

/** Mono PCM as Float32 samples in [-1, 1] plus its sample rate. The lingua
 *  franca between every stage — no Buffers, no base64, browser-native. */
interface PcmAudio {
    samples: Float32Array;
    sampleRate: number;
}
/**
 * A speaker identity vector — the zero-shot conditioning signal extracted from a
 * reference sample. L2-normalised so two clips of the same voice compare with
 * high cosine similarity. `data` is a plain number array for JSON/IDB/R2
 * portability, mirroring {@link MambaStateSnapshot}.
 */
interface SpeakerEmbedding {
    data: number[];
    dim: number;
    /** Sample rate the reference was analysed at — guards mismatched re-use. */
    sampleRate: number;
}
/** A discrete, compressed acoustic representation: `numFrames` time steps, each
 *  with `numQuantizers` residual-codebook token ids in [0, codebookSize). This
 *  is exactly what the SSM acoustic model predicts and what the codec decodes. */
interface CodecTokens {
    /** `[frame][quantizer]` token ids. */
    tokens: number[][];
    numFrames: number;
    numQuantizers: number;
    codebookSize: number;
    hopLength: number;
    frameLength: number;
    sampleRate: number;
}
/** One word's playback span in the synthesized audio — drives caption alignment
 *  and the AvatarWidget's `onBoundary`. */
interface WordTimestamp {
    word: string;
    startMs: number;
    endMs: number;
}
/** The provider seam: a swappable clone-synthesis backend. The studio ships the
 *  built-in `ssm-webgpu` provider; the npm package can register a `tts-server`
 *  provider that calls the gateway. Consumers resolve a provider, never branch
 *  on the id themselves (DRY — mirrors the device-router pattern). */
type VoiceProviderId = 'ssm-webgpu' | 'tts-server';
interface SpeakerEncoderOptions {
    /** Output embedding dimensionality. Default 256. */
    embeddingDim?: number;
    sampleRate?: number;
    numMels?: number;
}
interface NeuralCodecOptions {
    /** Residual quantizer depth. More stages → finer reconstruction. Default 4. */
    numQuantizers?: number;
    /** Entries per codebook. Default 256 (1 byte per token). */
    codebookSize?: number;
    sampleRate?: number;
    numMels?: number;
    frameLength?: number;
    hopLength?: number;
    /** Optional trained codebooks: `[quantizer][entry] = mel-dim centroid`. When
     *  omitted, deterministic seeded codebooks stand in (weight-free reference). */
    codebooks?: Float32Array[][];
}
interface AcousticModelOptions {
    sampleRate?: number;
    numMels?: number;
    hopLength?: number;
    frameLength?: number;
    numQuantizers?: number;
    codebookSize?: number;
    /** Characters spoken per second — sets how many mel frames a text spans.
     *  Default 14 (≈ natural English narration pace). */
    charsPerSecond?: number;
    /** SSM hidden dimension for the acoustic recurrence. Default 256. */
    hiddenDim?: number;
}
interface SynthesizeOptions {
    /** Text to speak. */
    text: string;
    /** The voice identity to speak it in. */
    speaker: SpeakerEmbedding;
    /** Playback speed multiplier (1 = natural). Scales predicted duration. */
    speed?: number;
    /** Forwarded to the device router; `cpu` forces the weight-free JS path. */
    device?: ActiveDevice;
    signal?: AbortSignal;
}
interface CloneSynthesisResult {
    /** Synthesized mono PCM in [-1, 1]. */
    pcm: Float32Array;
    sampleRate: number;
    durationMs: number;
    /** Per-word spans, aligned to the synthesized audio. */
    wordTimestamps: WordTimestamp[];
    /** The discrete tokens the audio was decoded from — persisted for the cache
     *  key and for re-vocoding with a better codec later without re-running the
     *  acoustic model. */
    codecTokens: CodecTokens;
    /** Which hardware path actually ran. */
    activeDevice: ActiveDevice;
}
/** A clone-synthesis backend. The engine and the npm package both consume this
 *  interface so a new model is a registry entry, not a call-site rewrite. */
interface VoiceProvider {
    readonly id: VoiceProviderId;
    /** Whether this backend can run in the current environment right now. The
     *  single source of truth for the honesty/fallback contract. */
    isAvailable(): Promise<boolean>;
    /** Human-readable reason when `isAvailable()` is false (shown to the user
     *  before any silent fallback). Null when available. */
    unavailableReason(): Promise<string | null>;
    synthesize(options: SynthesizeOptions): Promise<CloneSynthesisResult>;
}

/**
 * speaker-encoder (Phase 1) — reference audio ▶ a fixed-dim speaker identity
 * vector.
 *
 * This is the cheap, reusable half of the foundation: the conditioning signal
 * every later stage (the SSM acoustic model) reads to clone a voice. It is an
 * x-vector-style encoder — statistics pooling (mean + standard deviation of the
 * log-mel features across time) is exactly the pooling layer that turns a
 * variable-length utterance into a single utterance-level identity vector in the
 * x-vector / ECAPA-TDNN family. Mean captures the average spectral envelope
 * (formant/timbre fingerprint); std captures how that envelope moves (prosodic
 * texture). The pooled statistics are projected to `embeddingDim` and
 * L2-normalised so identity compares by cosine.
 *
 * Weight-free and deterministic, consistent with the rest of the studio engine
 * (see mamba-coherence's `projectState`): the projection is a fixed hashed
 * mixing matrix, not learned weights. Phase 2's training pipeline replaces the
 * projection with a trained encoder behind this exact signature; the contract
 * (mel stats → unit vector) is what downstream code depends on, not the weights.
 */

/**
 * Extract a speaker embedding from a reference sample. Empty/near-silent audio
 * yields a zero vector (every downstream conditioning step degrades to
 * "speaker-neutral" rather than throwing).
 */
declare function encodeSpeaker(reference: PcmAudio, options?: SpeakerEncoderOptions): SpeakerEmbedding;
/**
 * Verify two embeddings plausibly belong to the same speaker. Cosine ≥
 * `threshold` (default 0.75) → same voice. Used by the server publish/consent
 * gate (re-uploading must match the enrolled identity) and by tests.
 */
declare function verifySpeaker(a: SpeakerEmbedding, b: SpeakerEmbedding, threshold?: number): {
    same: boolean;
    similarity: number;
};

/**
 * neural-codec (Phase 1) — the discrete acoustic representation everything else
 * speaks.
 *
 * A Residual Vector Quantizer (RVQ) over log-mel frames: encode maps each mel
 * frame to `numQuantizers` codebook token ids by repeatedly subtracting the
 * nearest centroid and re-quantizing the residual (the EnCodec/DAC/SoundStream
 * scheme); decode sums the chosen centroids back into a mel frame and inverts it
 * to PCM through the shared vocoder in audio-frames. Discretising audio this way
 * is what lets the SSM acoustic model (Phase 2) *predict* speech as a sequence of
 * tokens — an autoregressive model over a small vocabulary — instead of
 * regressing raw samples.
 *
 * The codebooks here are deterministic, seeded placeholders (weight-free, like
 * the rest of the engine). A trained codec drops its learned codebooks in via
 * `NeuralCodecOptions.codebooks` behind the identical interface; round-trip
 * fidelity improves, call sites don't change. RVQ already gives graceful
 * degradation — fewer quantizers = coarser audio, never broken.
 */

declare class NeuralCodec {
    private readonly config;
    private readonly numQuantizers;
    private readonly codebookSize;
    /** `[quantizer][entry] = mel-dim centroid`. */
    private readonly codebooks;
    constructor(options?: NeuralCodecOptions);
    get quantizers(): number;
    get vocabSize(): number;
    get sampleRate(): number;
    /** PCM ▶ discrete tokens. */
    encode(audio: PcmAudio): CodecTokens;
    /** log-mel spectrogram ▶ discrete tokens. The acoustic model and the analysis
     *  path share this so quantisation lives in one place. */
    encodeMel(mel: MelSpectrogram): CodecTokens;
    /** Discrete tokens ▶ reconstructed log-mel spectrogram (sum of chosen
     *  centroids per frame). */
    decodeMel(codec: CodecTokens): MelSpectrogram;
    /** Discrete tokens ▶ PCM waveform (mel reconstruction → shared vocoder). */
    decode(codec: CodecTokens): PcmAudio;
}

/**
 * text-tokenizer (Phase 2) — text ▶ acoustic-model input tokens + word spans.
 *
 * A character-level tokenizer (the same grapheme-level granularity the host
 * frontend's mamba-engine uses for its character embeddings). Real TTS front-ends
 * run a grapheme-to-phoneme step here; a phonemizer drops in behind
 * `tokenizeText` without changing the acoustic model, and is tracked as a Gap
 * Register follow-up. Alongside the token ids we emit word boundaries so the
 * engine can turn predicted frame counts into `wordTimestamps` for captions.
 */
/** Vocabulary size including the reserved 0 token. */
declare const TEXT_VOCAB_SIZE: number;
interface TokenizedText {
    /** Per-character token ids (unknown chars → 0). */
    tokens: number[];
    /** Words in order, each with its [startChar, endChar) span over `tokens`. */
    words: {
        word: string;
        startChar: number;
        endChar: number;
    }[];
}
/** Normalise + tokenize. Collapses whitespace runs to single spaces so timing
 *  isn't thrown off by formatting. */
declare function tokenizeText(text: string): TokenizedText;

/**
 * ssm-acoustic-model (Phase 2) — the heart of the clone: (text tokens + speaker
 * embedding) ▶ a sequence of neural-codec tokens, generated autoregressively by
 * a selective state-space recurrence.
 *
 * This is the same architectural bet Cartesia's Sonic makes — an SSM backbone,
 * not a transformer, over discrete audio codec tokens — which is why it slots
 * onto the studio's existing Mamba substrate (mamba-coherence's `advanceState`
 * is the same `h_{t+1} = A·h_t + B·x_t` recurrence, here widened to a hidden
 * vector and conditioned on the voice). SSMs are linear-time and streaming, the
 * property that makes the $0-infra in-browser clone path viable where a
 * transformer's quadratic attention would not be.
 *
 * Conditioning is what makes it a *clone*: the speaker embedding is mixed into
 * every input step AND biases the per-quantizer output projection, so the same
 * text produces a different token stream — hence a different timbre after the
 * codec decodes it — per voice.
 *
 * The projections are deterministic seeded matrices (weight-free, like every
 * other studio engine module). With placeholder weights the output is
 * structured, voice- and text-dependent acoustic texture, not intelligible
 * speech — intelligibility is what the Phase 2 *training* run buys, dropping
 * trained matrices in behind this identical interface (`AcousticWeights`). The
 * inference architecture, shapes, conditioning, and streaming recurrence are
 * what's built here.
 */

interface AcousticGenerateResult {
    codec: CodecTokens;
    wordTimestamps: WordTimestamp[];
}
declare class SSMAcousticModel {
    private readonly cfg;
    /** Hashed character-embedding table [vocab][hiddenDim]. */
    private readonly charEmbed;
    /** Speaker-embedding → hidden projection (sign matrix), built lazily per
     *  speaker-dim so a mismatched embedding can't silently mis-multiply. */
    private speakerProj;
    /** Per-quantizer output projection: hidden → codebookSize logits. */
    private readonly outProj;
    /** SSM per-channel decay (diagonal A), stable in [0.5, 0.99). */
    private readonly decay;
    constructor(options?: AcousticModelOptions);
    /**
     * Generate codec tokens for `text` in the voice described by `speaker`.
     * `speed` (>0, default 1) scales the predicted duration: 1.5 ≈ 50 % faster.
     */
    generate(text: TokenizedText, speaker: SpeakerEmbedding, speed?: number): AcousticGenerateResult;
    /** hidden state → one token id per quantizer (argmax of speaker-biased logits). */
    private project;
    /** Project a speaker embedding to the hidden dim with a cached sign matrix. */
    private projectSpeaker;
}

/**
 * voice-clone-engine (Phase 2) — the one object that turns "speak this text in
 * this voice" into audio, wiring the Phase 1 + Phase 2 parts together:
 *
 *   reference PCM ─encodeSpeaker──▶ SpeakerEmbedding   (enrol, once per voice)
 *   text ─tokenizeText─▶ tokens ─SSMAcousticModel(speaker)─▶ codec tokens
 *   codec tokens ─NeuralCodec.decode──▶ PCM
 *
 * It picks a hardware path via the studio's shared device-router (never its own
 * WebGPU probe) and reports which path ran. The heavy SSM scan is intended to
 * ride the WebGPU Mamba kernel when present; the weight-free CPU recurrence in
 * SSMAcousticModel is the guaranteed-everywhere fallback. The output shape
 * (pcm + wordTimestamps + durationMs) is the server's `studio_voiceovers` row,
 * so cloned audio reaches captions / the AvatarWidget / the timeline unchanged.
 */

interface VoiceCloneEngineOptions {
    speaker?: SpeakerEncoderOptions;
    codec?: NeuralCodecOptions;
    acoustic?: AcousticModelOptions;
}
declare class VoiceCloneEngine {
    private readonly codec;
    private readonly acoustic;
    private readonly speakerOptions;
    private readonly sampleRate;
    constructor(options?: VoiceCloneEngineOptions);
    /** Enrol a voice: reference sample ▶ reusable speaker embedding. Run once and
     *  persist the embedding (it's just numbers) — synthesis takes the embedding,
     *  not the raw audio, so the reference never has to be re-fetched per clip. */
    enroll(reference: PcmAudio): SpeakerEmbedding;
    /** Speak `text` in `speaker`'s voice. */
    synthesize(options: SynthesizeOptions): Promise<CloneSynthesisResult>;
    /** Honour an explicit device, else probe (WebGPU preferred for the SSM scan,
     *  CPU always works). Never throws on probe failure — degrades to CPU. */
    private resolveDevice;
}

/**
 * provider — the swappable clone-synthesis backend seam (PRD §3's capability
 * rename: a `clone` engine with a pluggable provider, not the hardcoded
 * `vibevoice` flag).
 *
 * The studio ships one provider: `ssm-webgpu`, the in-browser SSM engine above.
 * The npm package registers a second, `tts-server`, that calls the gateway for
 * devices without WebGPU. Both satisfy {@link VoiceProvider}; callers resolve a
 * provider through {@link resolveVoiceProvider} and never branch on the id
 * themselves — the same DRY discipline as the device-router. `resolve` is also
 * the single source of truth for the honesty/fallback contract: it returns the
 * chosen provider AND, when nothing is available, the reason to show the user
 * *before* any silent fallback.
 */

/**
 * The built-in client-side provider: runs the full Phase 1 + Phase 2 pipeline on
 * the user's device. Always "available" because the SSM recurrence has a
 * weight-free CPU fallback — WebGPU only makes it faster. ($0 marginal infra,
 * per project_nle_decision.md.)
 */
declare class SSMVoiceProvider implements VoiceProvider {
    readonly id: "ssm-webgpu";
    private readonly engine;
    constructor(options?: VoiceCloneEngineOptions);
    /** Expose the engine for enrolment (`provider.engine.enroll(...)`). */
    get cloneEngine(): VoiceCloneEngine;
    isAvailable(): Promise<boolean>;
    unavailableReason(): Promise<string | null>;
    synthesize(options: SynthesizeOptions): Promise<CloneSynthesisResult>;
}
interface ResolveProviderResult {
    /** The chosen provider, or null when none is available. */
    provider: VoiceProvider | null;
    /** Why none was available (null when one was). Surface this BEFORE falling
     *  back to a non-cloned voice — never swap silently. */
    reason: string | null;
}
/**
 * Pick the first available provider from `providers`, in preference order.
 * Prefers `ssm-webgpu` when the device has WebGPU (free + private), otherwise
 * falls through to a server provider. This is the one place "which clone backend
 * runs right now" is decided.
 */
declare function resolveVoiceProvider(providers: VoiceProvider[]): Promise<ResolveProviderResult>;

/**
 * wav — encode mono Float32 PCM to a 16-bit WAV container.
 *
 * The clone engine emits raw Float32 samples (the studio's in-memory contract);
 * consumers that need a file/Blob — download, R2 upload, <audio src> — get a
 * standard 16-bit PCM WAV here. Kept dependency-free and browser/Node-portable
 * (returns an ArrayBuffer; `encodeWavBlob` wraps it as a Blob only where the DOM
 * type exists).
 */

/** Float32 PCM [-1, 1] → 16-bit little-endian WAV bytes. */
declare function encodeWav(audio: PcmAudio): ArrayBuffer;
/** Same as {@link encodeWav} but wrapped as a `Blob` (browser/worker only). */
declare function encodeWavBlob(audio: PcmAudio): Blob;

export { type AcousticGenerateResult, type AcousticModelOptions, ActiveDevice, CAMERA_MOVES, CameraMove, CharacterBible, type CloneSynthesisResult, type CodecTokens, DiffusionModelId, FrameValidation, GenerateOptions, GenerateResult, type InterpolatedSlot, type Keyframe, MODEL_REGISTRY, MambaStateSnapshot, type MelConfig, type MelSpectrogram, ModelDescriptor, type MotionField, type MotionOptions, NeuralCodec, type NeuralCodecOptions, type OnnxRuntimeConfigOptions, type PcmAudio, PlannedShot, type ResolveProviderResult, SSMAcousticModel, SSMVoiceProvider, ScenePlanOptions, type SpeakerEmbedding, type SpeakerEncoderOptions, Storyboard, StoryboardGenerateOptions, StoryboardGenerateResult, type SynthesizeOptions, TEXT_VOCAB_SIZE, type TokenizedText, ValidateFrameOptions, VideoEngine, VideoEngineOptions, VoiceCloneEngine, type VoiceCloneEngineOptions, type VoiceProvider, type VoiceProviderId, type WordTimestamp, buildInterpolatedSequence, cameraMoveToMotion, composeShotPrompt, configureOnnxRuntime, cosineSimilarity, directorPass, encodeSpeaker, encodeWav, encodeWavBlob, estimateBlockMotion, interpolateFrames, luma, melSpectrogram, melToWaveform, normaliseShotBudget, planKeyframeIndices, planScene, resolveVoiceProvider, shotPlannerPass, slerp, storyboardFrameCount, tokenizeText, validateFrame, verifySpeaker };

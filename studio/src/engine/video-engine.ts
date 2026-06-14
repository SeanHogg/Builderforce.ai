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

import type {
  ActiveDevice,
  CharacterBible,
  CoherenceMode,
  FrameValidation,
  GenerateOptions,
  InterpolationBackend,
  GenerateResult,
  MambaStateSnapshot,
  PlannedShot,
  ShotValidation,
  StoryboardGenerateOptions,
  StoryboardGenerateResult,
  VideoEngineOptions,
  WeightSource,
} from '../types';
import { probeDevice } from './device-router';
import { DiffusionEngine, MODEL_REGISTRY, reportProgress } from './diffusion-engine';
import {
  advanceState,
  anchorWalkLatent,
  applyToLatent,
  applyToPrompt,
  emptyState,
  isAnchorRefreshFrame,
  latentResidualBiasScale,
  scaleLatent,
  shiftLatent,
} from './mamba-coherence';
import {
  buildInterpolatedSequence,
  planKeyframeIndices,
  type Keyframe,
} from './frame-interpolator';
import { estimateBlockMotion, interpolateFrames, type MotionField } from './motion-interpolator';
import { cameraMoveToMotion, composeShotPrompt } from './scene-planner';
import { validateFrame } from './frame-validator';
import { expandPrompt } from './llm-bridge';
import { muxFramesToMp4, pixelsToRgba, type MuxFrame } from './webcodecs-muxer';

const DEFAULT_WIDTH = 512;
const DEFAULT_HEIGHT = 512;
const DEFAULT_WEIGHT_SOURCES: WeightSource[] = ['r2-proxy', 'huggingface-cdn'];
const DEFAULT_COHERENCE: CoherenceMode = 'prompt-bias';
const DEFAULT_COHERENCE_STRENGTH = 0.5;
/**
 * Fraction of fresh noise per frame mixed into the shared anchor latent.
 * 0.15 was chosen empirically: small enough that color palette and composition
 * stay locked across frames (the bug this fixes), large enough that frames
 * still evolve so the result reads as motion, not as a static image looped.
 */
const DEFAULT_MOTION_AMOUNT = 0.15;
/** Default refinement-pass img2img strength when the engine runs a two-pass
 *  quality chain. 0.4 = preserves the draft's composition while letting the
 *  refinement model rewrite ~40 % of the noise schedule's worth of detail. */
const DEFAULT_REFINEMENT_STRENGTH = 0.4;

export class VideoEngine {
  /** Track the probed device so we can lazy-create a refinement-pass engine
   *  later with the same hardware target — needed for the two-pass quality
   *  chain (draft model → dispose → refinement model). */
  private readonly probed: import('./device-router').ProbedDevice;

  private constructor(
    private readonly opts: Required<Pick<VideoEngineOptions, 'apiKey' | 'model'>> & VideoEngineOptions,
    private diffusion: DiffusionEngine,
    private mambaState: MambaStateSnapshot,
    public readonly activeDevice: ActiveDevice,
    probed: import('./device-router').ProbedDevice,
  ) {
    this.probed = probed;
  }

  /**
   * Construct an engine bound to the host's best available hardware. Returns
   * `null` when no device path is viable — the consumer should render an
   * unsupported state rather than try to recover.
   */
  static async create(options: VideoEngineOptions): Promise<VideoEngine | null> {
    reportProgress(`Probing hardware (target: ${options.device ?? 'auto'})…`, options.onProgress);
    const probed = await probeDevice(options.device ?? 'auto');
    if (!probed) return null;
    reportProgress(`Hardware ready: ${probed.label} (${probed.kind}).`, options.onProgress);

    const width = options.width ?? DEFAULT_WIDTH;
    const height = options.height ?? DEFAULT_HEIGHT;
    const weightSources = options.weightSources ?? DEFAULT_WEIGHT_SOURCES;

    const diffusion = new DiffusionEngine({
      model: options.model,
      probed,
      apiKey: options.apiKey,
      weightSources,
      r2Base: deriveR2Base(options.baseUrl),
      width,
      height,
      onProgress: options.onProgress,
    });

    await diffusion.init();

    const state =
      options.mambaState ?? emptyState({ dim: 64, order: 4, channels: 16 });

    return new VideoEngine(
      { ...options, weightSources, width, height },
      diffusion,
      state,
      probed.kind,
      probed,
    );
  }

  /**
   * Generate one video clip. Per-keyframe work is sequential (keyframes depend
   * on the previous keyframe's Mamba state). With `interpolationFactor > 1`,
   * only keyframes run the diffusion denoise loop and the frames between them
   * are slerp-interpolated in latent space (one cheap VAE decode each). Returns
   * the muxed MP4 plus the updated state.
   */
  async generate(args: GenerateOptions): Promise<GenerateResult> {
    const start = performance.now();
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const steps = args.steps ?? descriptor.defaultSteps;
    const guidance = args.guidance ?? descriptor.defaultGuidance;
    const coherenceMode = args.coherence ?? DEFAULT_COHERENCE;
    const coherenceStrength = args.coherenceStrength ?? DEFAULT_COHERENCE_STRENGTH;
    const seed = args.seed ?? Date.now();
    const width = this.opts.width ?? DEFAULT_WIDTH;
    const height = this.opts.height ?? DEFAULT_HEIGHT;

    const onProgress = args.onProgress;

    if (!args.skipPromptExpansion) {
      reportProgress('Expanding prompt via Builderforce LLM gateway…', onProgress);
    }
    const resolvedPrompt = args.skipPromptExpansion
      ? args.prompt
      : await expandPrompt({
          apiKey: this.opts.apiKey,
          baseUrl: this.opts.baseUrl,
          promptModel: this.opts.promptModel,
          prompt: args.prompt,
          signal: args.signal,
        });

    args.onPromptExpanded?.(resolvedPrompt);

    reportProgress('Encoding prompt with CLIP text encoder…', onProgress);
    const promptEmbedding = await this.diffusion.embedPrompt(resolvedPrompt);
    const negativeEmbedding = args.negativePrompt
      ? await this.diffusion.embedPrompt(args.negativePrompt)
      : null;

    const clip = await this.produceClip({
      frameCount: args.frames,
      promptEmbedding,
      negativeEmbedding,
      timesteps: trimTimesteps(descriptor.defaultTimesteps, steps),
      guidance,
      coherenceMode,
      coherenceStrength,
      seed,
      motionAmount: clamp01(args.motionAmount ?? DEFAULT_MOTION_AMOUNT),
      imgToImgStrength: clamp01(args.imgToImgStrength ?? 0),
      anchorRefreshInterval: normaliseRefreshInterval(args.anchorRefreshInterval),
      cameraMotion: args.cameraMotion,
      interpolationFactor: normaliseFactor(args.interpolationFactor),
      interpolationBackend: args.interpolationBackend ?? 'latent-slerp',
      width,
      height,
      label: 'Frame',
      frameOffset: 0,
      onProgress,
      onFrame: args.onFrame,
      signal: args.signal,
    });

    // Two-pass refinement: if a refinementModel was wired at create time, swap
    // to it and re-noise + partial-denoise every produced frame's clean latent
    // through the refinement UNet. Sequential model load keeps VRAM at
    // max(draft, refinement). Operates on ALL produced frames (keyframes AND
    // interpolated tweens — both carry a latent), so refinement sharpens the
    // whole clip uniformly.
    let refined: ProducedClip | null = null;
    if (this.opts.refinementModel && this.opts.refinementModel !== this.opts.model) {
      // refinementPass owns the draft bitmaps' lifecycle (closes the ones it
      // replaces, reuses the motion-tweens it carries through).
      refined = await this.refinementPass(clip, {
        resolvedPrompt,
        seed,
        width,
        height,
        refinementStrength: clamp01(args.refinementStrength ?? DEFAULT_REFINEMENT_STRENGTH),
        onProgress,
        onFrame: args.onFrame,
        signal: args.signal,
      });
    }

    const finalFrames = refined?.frames ?? clip.frames;
    const finalMuxFrames = refined?.muxFrames ?? clip.muxFrames;

    reportProgress(`Encoding ${finalFrames.length} frames to MP4…`, onProgress);
    const blob = await muxFramesToMp4(finalMuxFrames, {
      width,
      height,
      fps: args.fps,
      signal: args.signal,
    });
    reportProgress('MP4 ready.', onProgress);

    return {
      blob,
      mambaState: this.mambaState,
      frames: finalFrames,
      activeDevice: this.activeDevice,
      resolvedPrompt,
      elapsedMs: performance.now() - start,
    };
  }

  /**
   * Render a full storyboard (the Director / Shot-Planner output) into one MP4.
   * Each shot is generated as its own clip — the shot's composed prompt (shot
   * text + locked character appearances) is embedded fresh, the camera move is
   * mapped to latent motion + img2img recursion, and the Mamba state is carried
   * ACROSS shots so the SSM memory threads continuity through the whole scene.
   * When `validate` is set, each shot's first keyframe is checked by the VLM
   * frame validator (advisory — never blocks generation).
   */
  async generateStoryboard(args: StoryboardGenerateOptions): Promise<StoryboardGenerateResult> {
    const start = performance.now();
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const steps = args.steps ?? descriptor.defaultSteps;
    const guidance = args.guidance ?? descriptor.defaultGuidance;
    const coherenceMode = args.coherence ?? DEFAULT_COHERENCE;
    const coherenceStrength = args.coherenceStrength ?? DEFAULT_COHERENCE_STRENGTH;
    const seedBase = args.seed ?? Date.now();
    const width = this.opts.width ?? DEFAULT_WIDTH;
    const height = this.opts.height ?? DEFAULT_HEIGHT;
    const onProgress = args.onProgress;
    const interpolationFactor = normaliseFactor(args.interpolationFactor);
    const timesteps = trimTimesteps(descriptor.defaultTimesteps, steps);

    const { storyboard } = args;
    const allFrames: ImageBitmap[] = [];
    const allMuxFrames: MuxFrame[] = [];
    let allLatents: (Float32Array | null)[] = [];
    const validations: ShotValidation[] = [];
    const maxRetries = args.validate ? Math.max(0, Math.floor(args.maxValidationRetries ?? 1)) : 0;
    let globalIdx = 0;

    for (let s = 0; s < storyboard.shots.length; s++) {
      if (args.signal?.aborted) throw new DOMException('Generation aborted', 'AbortError');
      const shot = storyboard.shots[s];
      const shotPrompt = composeShotPrompt(shot, storyboard.characters);
      reportProgress(
        `Shot ${s + 1}/${storyboard.shots.length} (${shot.camera}, ${shot.durationFrames}f): ${shotPrompt}`,
        onProgress,
      );
      const shotEmbedding = await this.diffusion.embedPrompt(shotPrompt);

      const { clip, validation } = await this.renderShot({
        shot,
        characters: storyboard.characters,
        shotEmbedding,
        shotIndex: s,
        shotCount: storyboard.shots.length,
        baseSeed: seedBase + s * 100003,
        timesteps,
        guidance,
        coherenceMode,
        coherenceStrength,
        motionAmount: clamp01(args.motionAmount ?? DEFAULT_MOTION_AMOUNT),
        interpolationFactor,
        interpolationBackend: args.interpolationBackend ?? 'latent-slerp',
        width,
        height,
        frameOffset: globalIdx,
        validate: Boolean(args.validate),
        validatorModel: args.validatorModel,
        passThreshold: args.passThreshold,
        maxRetries,
        onProgress,
        onFrame: args.onFrame,
        signal: args.signal,
      });

      if (validation) {
        validations.push({ shotId: shot.id, frameIndex: globalIdx, validation });
      }
      allFrames.push(...clip.frames);
      allMuxFrames.push(...clip.muxFrames);
      allLatents.push(...clip.latents);
      globalIdx += clip.frames.length;
      args.onShot?.(s, shot, validation);
    }

    // Two-pass refinement for the WHOLE scene: generate every shot with the
    // draft model first, then run ONE refinement pass over all collected
    // latents after a single model swap — so the Refined tier works for
    // cinematic output without reloading weights per shot.
    let finalFrames = allFrames;
    let finalMuxFrames = allMuxFrames;
    if (this.opts.refinementModel && this.opts.refinementModel !== this.opts.model) {
      // refinementPass owns the draft bitmaps' lifecycle (closes replaced ones,
      // carries motion-tweens through). One pass over the whole concatenated clip.
      const refined = await this.refinementPass(
        { frames: allFrames, muxFrames: allMuxFrames, latents: allLatents },
        {
          resolvedPrompt: storyboard.treatment,
          seed: seedBase,
          width,
          height,
          refinementStrength: clamp01(DEFAULT_REFINEMENT_STRENGTH),
          onProgress,
          onFrame: args.onFrame,
          signal: args.signal,
        },
      );
      finalFrames = refined.frames;
      finalMuxFrames = refined.muxFrames;
      allLatents = refined.latents;
    }

    reportProgress(`Encoding ${finalFrames.length} frames to MP4…`, onProgress);
    const blob = await muxFramesToMp4(finalMuxFrames, {
      width,
      height,
      fps: args.fps,
      signal: args.signal,
    });
    reportProgress('MP4 ready.', onProgress);

    return {
      blob,
      mambaState: this.mambaState,
      frames: finalFrames,
      activeDevice: this.activeDevice,
      storyboard,
      validations,
      elapsedMs: performance.now() - start,
    };
  }

  /**
   * Render one storyboard shot, with self-healing validation retries. Generates
   * the clip, validates its first + last keyframe, and — if validation fails and
   * retries remain — re-renders with a fresh seed, keeping the highest-scoring
   * attempt. The Mamba state is snapshotted before each attempt and restored, so
   * a discarded attempt doesn't pollute cross-shot continuity; the kept
   * attempt's state is committed on return.
   */
  private async renderShot(args: {
    shot: PlannedShot;
    characters: CharacterBible[];
    shotEmbedding: Float32Array;
    shotIndex: number;
    shotCount: number;
    baseSeed: number;
    timesteps: number[];
    guidance: number;
    coherenceMode: CoherenceMode;
    coherenceStrength: number;
    motionAmount: number;
    interpolationFactor: number;
    interpolationBackend: InterpolationBackend;
    width: number;
    height: number;
    frameOffset: number;
    validate: boolean;
    validatorModel?: string;
    passThreshold?: number;
    maxRetries: number;
    onProgress?: (label: string) => void;
    onFrame?: GenerateOptions['onFrame'];
    signal?: AbortSignal;
  }): Promise<{ clip: ProducedClip; validation: FrameValidation | null }> {
    const motion = cameraMoveToMotion(args.shot.camera);
    const stateBefore = this.mambaState;
    let best: {
      clip: ProducedClip;
      validation: FrameValidation | null;
      state: MambaStateSnapshot;
    } | null = null;

    for (let attempt = 0; attempt <= args.maxRetries; attempt++) {
      if (args.signal?.aborted) throw new DOMException('Generation aborted', 'AbortError');
      // Each attempt starts from the same pre-shot state so retries don't stack
      // Mamba drift; vary the seed so the re-render actually differs.
      this.mambaState = stateBefore;
      if (attempt > 0) {
        reportProgress(
          `Shot ${args.shotIndex + 1}/${args.shotCount}: validation retry ${attempt}/${args.maxRetries}…`,
          args.onProgress,
        );
      }
      const clip = await this.produceClip({
        frameCount: args.shot.durationFrames,
        promptEmbedding: args.shotEmbedding,
        negativeEmbedding: null,
        timesteps: args.timesteps,
        guidance: args.guidance,
        coherenceMode: args.coherenceMode,
        coherenceStrength: args.coherenceStrength,
        seed: args.baseSeed + attempt * 7919,
        motionAmount: args.motionAmount,
        imgToImgStrength: motion.imgToImgStrength,
        // Shots are short and Mamba state resets per shot, so per-shot recursion
        // drift is already bounded by the shot length — no periodic refresh.
        anchorRefreshInterval: 0,
        cameraMotion: motion.cameraMotion,
        interpolationFactor: args.interpolationFactor,
        interpolationBackend: args.interpolationBackend,
        width: args.width,
        height: args.height,
        label: `Shot ${args.shotIndex + 1}`,
        frameOffset: args.frameOffset,
        onProgress: args.onProgress,
        onFrame: args.onFrame,
        signal: args.signal,
      });

      const validation = args.validate
        ? await this.validateShot(clip, {
            shot: args.shot,
            characters: args.characters,
            width: args.width,
            height: args.height,
            validatorModel: args.validatorModel,
            passThreshold: args.passThreshold,
            signal: args.signal,
            onProgress: args.onProgress,
          })
        : null;

      const score = validation?.score ?? 1;
      const prevBestScore = best?.validation?.score ?? -1;
      if (!best || score > prevBestScore) {
        // New best — close the previous best's bitmaps (it's discarded).
        if (best) closeClip(best.clip);
        best = { clip, validation, state: this.mambaState };
      } else {
        closeClip(clip); // worse attempt — release its bitmaps
      }

      // Stop early once a validated attempt passes (or validation is off).
      if (!validation || validation.ok) break;
    }

    // Commit the kept attempt's Mamba state for cross-shot continuity.
    this.mambaState = best!.state;
    return { clip: best!.clip, validation: best!.validation };
  }

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
  private async produceClip(spec: ClipSpec): Promise<ProducedClip> {
    const {
      frameCount,
      promptEmbedding,
      negativeEmbedding,
      timesteps,
      guidance,
      coherenceMode,
      coherenceStrength,
      seed,
      motionAmount,
      imgToImgStrength,
      anchorRefreshInterval,
      cameraMotion,
      interpolationFactor,
      interpolationBackend,
      width,
      height,
      label,
      frameOffset,
      onProgress,
      onFrame,
      signal,
    } = spec;
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const latentH = height / 8;
    const latentW = width / 8;

    // One anchor latent for the whole clip locks colors/composition; the
    // per-frame drift walks a SMOOTH great-circle arc between two fixed endpoint
    // noises (walkStart → walkEnd) so consecutive frames are adjacent. Sampling
    // i.i.d. noise per frame produced visually unrelated stills (diffusion is
    // dominated by initial noise) — and even blended with the anchor it jittered
    // because each frame drifted in a random direction. anchorWalkLatent() makes
    // the drift monotonic so the sequence reads as incremental motion, not
    // flicker. motionAmount scales how far each step pulls from the anchor.
    const anchorLatent = this.diffusion.sampleInitialLatent(seed);
    const walkStart = this.diffusion.sampleInitialLatent(seed + 1);
    const walkEnd = this.diffusion.sampleInitialLatent(seed + 2);

    const keyframeIndices = planKeyframeIndices(frameCount, interpolationFactor);
    let prevLatent: Float32Array | null = null;
    const keyframes: Keyframe[] = [];
    // Decoded keyframe outputs, parallel to `keyframes`, reused at assembly time.
    // `pixels` (planar RGB [-1..1]) is kept for the motion backend, which warps
    // between decoded keyframes rather than slerping their latents.
    const keyframeOutputs: {
      rgba: Uint8ClampedArray;
      bitmap: ImageBitmap;
      pixels: Float32Array;
    }[] = [];

    for (let k = 0; k < keyframeIndices.length; k++) {
      if (signal?.aborted) throw new DOMException('Generation aborted', 'AbortError');
      const frameIdx = keyframeIndices[k];

      const conditionedPrompt =
        coherenceMode === 'prompt-bias'
          ? applyToPrompt({
              ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
              promptEmbedding,
              seqLen: descriptor.sequenceLength,
              embedDim: descriptor.textEmbedDim,
            })
          : promptEmbedding;

      // Periodically drop back to a fresh full-noise anchor to bound img2img
      // recursion's accumulating VAE round-trip blur on long clips. On a refresh
      // keyframe we take the anchor-walk (fresh-noise) branch instead of carrying
      // the prior latent forward. See `isAnchorRefreshFrame`.
      const refresh = isAnchorRefreshFrame(k, anchorRefreshInterval);
      const useImg2Img = imgToImgStrength > 0 && prevLatent !== null && !refresh;
      let latent: Float32Array;
      let frameTimesteps: number[];
      if (refresh) {
        reportProgress(
          `${label} ${frameIdx + 1}/${frameCount}: anchor refresh (bounding recursion drift)…`,
          onProgress,
        );
      }
      if (useImg2Img) {
        // Carry the prior keyframe's clean latent forward, optionally pan +
        // zoom it for camera motion, then re-noise to a partial timestep so the
        // remaining denoise steps refine (not redraw) the scene. Zoom (dolly)
        // is applied after the shift so a combined move composes naturally.
        let transformed = prevLatent!;
        const latentShape = { channels: 4, height: latentH, width: latentW };
        if (cameraMotion && (cameraMotion.dx !== 0 || cameraMotion.dy !== 0)) {
          transformed = shiftLatent(transformed, latentShape, cameraMotion.dx, cameraMotion.dy);
        }
        if (cameraMotion?.zoom && cameraMotion.zoom !== 1) {
          transformed = scaleLatent(transformed, latentShape, cameraMotion.zoom);
        }
        const shifted = transformed;
        const skipCount = Math.floor(timesteps.length * (1 - imgToImgStrength));
        const truncated = timesteps.slice(skipCount);
        frameTimesteps = truncated.length > 0 ? truncated : [timesteps[timesteps.length - 1]];
        latent = this.diffusion.addNoiseToLatent(shifted, frameTimesteps[0], seed + frameIdx);
      } else {
        latent = anchorWalkLatent(anchorLatent, walkStart, walkEnd, frameIdx, frameCount, motionAmount);
        frameTimesteps = timesteps;
      }
      // Scale the latent-residual Mamba bias by the latent's noise fraction so
      // it composes with img2img recursion instead of disfiguring the carried-
      // forward signal. On the fresh-noise path the scale is 1 (pure noise);
      // under img2img it's sqrt(1-ᾱ_t) at the re-noise timestep. The rule lives
      // in one unit-tested helper — see `latentResidualBiasScale`.
      const biasNoiseScale = latentResidualBiasScale(
        coherenceMode,
        useImg2Img,
        useImg2Img ? this.diffusion.noiseScaleForTimestep(frameTimesteps[0]) : 1,
      );
      if (biasNoiseScale > 0) {
        latent = applyToLatent({
          ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
          latent,
          noiseScale: biasNoiseScale,
        });
      }

      reportProgress(
        `${label} ${frameIdx + 1}/${frameCount} (keyframe ${k + 1}/${keyframeIndices.length}): ${useImg2Img ? `img2img (${frameTimesteps.length}/${timesteps.length} steps)` : 'denoising'}…`,
        onProgress,
      );
      const { pixels, latent: finalLatent } = await this.diffusion.denoise({
        latent,
        condEmbedding: conditionedPrompt,
        uncondEmbedding: negativeEmbedding,
        timesteps: frameTimesteps,
        guidance,
        seed: seed + frameIdx,
        onStep: (step, total) =>
          reportProgress(`${label} ${frameIdx + 1}/${frameCount}: denoise step ${step}/${total}…`, onProgress),
      });
      prevLatent = finalLatent;

      const rgba = pixelsToRgba(pixels, width, height);
      const bitmap = await createImageBitmap(
        new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height),
      );
      this.mambaState = advanceState(this.mambaState, pixels);
      keyframes.push({ outputIndex: frameIdx, latent: finalLatent });
      keyframeOutputs.push({ rgba, bitmap, pixels });
      // Emit each keyframe as it finishes so the consumer's preview / progress
      // bar advances during the expensive denoise loop rather than jumping at
      // the end. Tweens emit below as they're decoded. previewFrames is
      // reconciled against the final ordered `frames` by the consumer, so this
      // not-strictly-in-order emission is safe.
      onFrame?.(frameOffset + frameIdx, bitmap, this.mambaState);
    }

    // Expand the sparse keyframes into the full ordered sequence. The `latents`
    // array is ALWAYS the slerp expansion (one latent per frame) so the
    // refinement pass has a latent for every slot regardless of backend. The
    // displayed PIXELS for a tween come from the selected backend:
    //   latent-slerp → VAE-decode the slerped latent.
    //   motion       → block optical-flow warp between the two decoded keyframes.
    const slots = buildInterpolatedSequence(keyframes);
    const frames: ImageBitmap[] = new Array(frameCount);
    const muxFrames: MuxFrame[] = new Array(frameCount);
    const latents: (Float32Array | null)[] = new Array(frameCount);
    const useMotion = interpolationBackend === 'motion' && keyframes.length > 1;
    // Lazily-estimated motion field per keyframe gap (keyed by left keyframe
    // array index), so each gap's flow is computed once and shared by its tweens.
    const motionFields = new Map<number, MotionField>();
    let leftKi = 0; // updated as we pass each keyframe slot; brackets the tweens

    for (const slot of slots) {
      if (signal?.aborted) throw new DOMException('Generation aborted', 'AbortError');
      if (!slot.isTween) {
        const ki = slot.keyframeIndex!;
        leftKi = ki;
        frames[slot.outputIndex] = keyframeOutputs[ki].bitmap;
        muxFrames[slot.outputIndex] = { rgba: keyframeOutputs[ki].rgba };
        latents[slot.outputIndex] = keyframes[ki].latent;
        continue;
      }

      let pixels: Float32Array;
      if (useMotion && leftKi + 1 < keyframes.length) {
        const k0 = keyframes[leftKi];
        const k1 = keyframes[leftKi + 1];
        const span = k1.outputIndex - k0.outputIndex;
        const t = span > 0 ? (slot.outputIndex - k0.outputIndex) / span : 0.5;
        reportProgress(`${label} ${slot.outputIndex + 1}/${frameCount}: motion-warp…`, onProgress);
        let field = motionFields.get(leftKi);
        if (!field) {
          field = estimateBlockMotion(
            keyframeOutputs[leftKi].pixels,
            keyframeOutputs[leftKi + 1].pixels,
            width,
            height,
          );
          motionFields.set(leftKi, field);
        }
        pixels = interpolateFrames(
          keyframeOutputs[leftKi].pixels,
          keyframeOutputs[leftKi + 1].pixels,
          width,
          height,
          t,
          field,
        );
        // No true latent — the refinement pass carries this warped frame through
        // unchanged rather than re-rendering it from a stand-in latent.
        latents[slot.outputIndex] = null;
      } else {
        reportProgress(`${label} ${slot.outputIndex + 1}/${frameCount}: interpolating…`, onProgress);
        pixels = await this.diffusion.decodeLatent(slot.latent!);
        latents[slot.outputIndex] = slot.latent!;
      }
      const rgba = pixelsToRgba(pixels, width, height);
      const bitmap = await createImageBitmap(
        new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height),
      );
      frames[slot.outputIndex] = bitmap;
      muxFrames[slot.outputIndex] = { rgba };
      onFrame?.(frameOffset + slot.outputIndex, bitmap, this.mambaState);
    }

    return { frames, muxFrames, latents };
  }

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
  private async refinementPass(
    clip: ProducedClip,
    opts: {
      resolvedPrompt: string;
      seed: number;
      width: number;
      height: number;
      refinementStrength: number;
      onProgress?: (label: string) => void;
      onFrame?: GenerateOptions['onFrame'];
      signal?: AbortSignal;
    },
  ): Promise<ProducedClip> {
    const { onProgress } = opts;
    const { latents } = clip;
    reportProgress(
      `Refinement pass: swapping ${this.opts.model} → ${this.opts.refinementModel} (sequential, no VRAM cost)…`,
      onProgress,
    );
    await this.diffusion.dispose();
    this.diffusion = new DiffusionEngine({
      model: this.opts.refinementModel!,
      probed: this.probed,
      apiKey: this.opts.apiKey,
      weightSources: this.opts.weightSources ?? DEFAULT_WEIGHT_SOURCES,
      r2Base: deriveR2Base(this.opts.baseUrl),
      width: opts.width,
      height: opts.height,
      onProgress,
    });
    await this.diffusion.init();
    // Re-embed under the refinement model's text encoder (LCM family shares
    // dims, but encoder weights differ).
    const refinedCondEmbedding = await this.diffusion.embedPrompt(opts.resolvedPrompt);
    const refinedDescriptor = MODEL_REGISTRY[this.opts.refinementModel!];
    const refinedTimesteps = trimTimesteps(refinedDescriptor.defaultTimesteps, refinedDescriptor.defaultSteps);
    const skipCount = Math.floor(refinedTimesteps.length * (1 - opts.refinementStrength));
    const partialTimesteps =
      skipCount < refinedTimesteps.length
        ? refinedTimesteps.slice(skipCount)
        : [refinedTimesteps[refinedTimesteps.length - 1]];

    const frames: ImageBitmap[] = new Array(latents.length);
    const muxFrames: MuxFrame[] = new Array(latents.length);
    const outLatents: (Float32Array | null)[] = new Array(latents.length);
    let refinedCount = 0;
    for (let i = 0; i < latents.length; i++) {
      if (opts.signal?.aborted) throw new DOMException('Generation aborted', 'AbortError');
      const latent = latents[i];
      if (latent === null) {
        // Motion-warp tween — carry the draft frame through untouched.
        frames[i] = clip.frames[i];
        muxFrames[i] = clip.muxFrames[i];
        outLatents[i] = null;
        continue;
      }
      reportProgress(`Refinement pass: frame ${i + 1}/${latents.length}…`, onProgress);
      const noised = this.diffusion.addNoiseToLatent(latent, partialTimesteps[0], opts.seed + i);
      const { pixels, latent: refinedLatent } = await this.diffusion.denoise({
        latent: noised,
        condEmbedding: refinedCondEmbedding,
        uncondEmbedding: null,
        timesteps: partialTimesteps,
        guidance: refinedDescriptor.defaultGuidance,
        seed: opts.seed + i,
      });
      const rgba = pixelsToRgba(pixels, opts.width, opts.height);
      const bitmap = await createImageBitmap(
        new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, opts.width, opts.height),
      );
      // Replace + close the draft bitmap this refined frame supersedes.
      try { clip.frames[i].close(); } catch { /* already closed */ }
      frames[i] = bitmap;
      muxFrames[i] = { rgba };
      outLatents[i] = refinedLatent;
      refinedCount++;
      opts.onFrame?.(i, bitmap, this.mambaState);
    }
    reportProgress(`Refinement pass complete (${refinedCount}/${latents.length} frames refined).`, onProgress);
    return { frames, muxFrames, latents: outLatents };
  }

  /**
   * Validate a shot through the VLM by checking its FIRST and LAST keyframe
   * (mid-shot drift is invisible to a single-frame check). Returns the merged
   * verdict: `ok` only if both ends pass, `score` is the worse of the two, and
   * issues are concatenated. Returns null when validation can't run at all (no
   * OffscreenCanvas / both calls failed) so the caller treats it as advisory.
   */
  private async validateShot(
    clip: ProducedClip,
    ctx: {
      shot: PlannedShot;
      characters: CharacterBible[];
      width: number;
      height: number;
      validatorModel?: string;
      passThreshold?: number;
      signal?: AbortSignal;
      onProgress?: (label: string) => void;
    },
  ): Promise<FrameValidation | null> {
    if (clip.muxFrames.length === 0) return null;
    const lastIdx = clip.muxFrames.length - 1;
    // First + last (deduped when the shot is a single frame).
    const indices = lastIdx === 0 ? [0] : [0, lastIdx];
    const verdicts = (
      await Promise.all(
        indices.map((i) =>
          this.validateOneFrame(clip.muxFrames[i], `frame ${i + 1}`, ctx),
        ),
      )
    ).filter((v): v is FrameValidation => v !== null);
    if (verdicts.length === 0) return null;
    return {
      ok: verdicts.every((v) => v.ok),
      score: Math.min(...verdicts.map((v) => v.score)),
      issues: verdicts.flatMap((v) => v.issues),
    };
  }

  /**
   * Validate ONE frame of a shot through the VLM. Encodes the raw RGBA to a
   * JPEG data URL (via OffscreenCanvas) and asks the gateway's vision model
   * whether it matches the shot + character bible. Advisory: any failure
   * (no OffscreenCanvas, gateway down) returns null.
   */
  private async validateOneFrame(
    frame: MuxFrame,
    frameLabel: string,
    ctx: {
      shot: PlannedShot;
      characters: CharacterBible[];
      width: number;
      height: number;
      validatorModel?: string;
      passThreshold?: number;
      signal?: AbortSignal;
      onProgress?: (label: string) => void;
    },
  ): Promise<FrameValidation | null> {
    try {
      reportProgress(`Validating shot "${ctx.shot.id}" ${frameLabel} via VLM…`, ctx.onProgress);
      const dataUrl = await rgbaToDataUrl(frame.rgba, ctx.width, ctx.height);
      if (!dataUrl) return null;
      const present = ctx.shot.characterIds
        .map((id) => ctx.characters.find((c) => c.id === id))
        .filter((c): c is CharacterBible => Boolean(c))
        .map((c) => ({ name: c.name, appearance: c.appearance }));
      return await validateFrame({
        apiKey: this.opts.apiKey,
        baseUrl: this.opts.baseUrl,
        validatorModel: ctx.validatorModel,
        frameDataUrl: dataUrl,
        shotDescription: `${ctx.shot.prompt} — action: ${ctx.shot.action}`,
        characters: present,
        passThreshold: ctx.passThreshold,
        signal: ctx.signal,
      });
    } catch {
      return null;
    }
  }

  /** Read the current Mamba state without mutating the engine — for persistence. */
  getMambaState(): MambaStateSnapshot {
    return this.mambaState;
  }

  /** Replace the Mamba state — used when resuming a session from R2 / IDB. */
  setMambaState(state: MambaStateSnapshot): void {
    this.mambaState = state;
  }

  /** Release ORT sessions + GPUDevice. Idempotent. After dispose the engine
   *  cannot be reused — create a new one with VideoEngine.create. */
  async dispose(): Promise<void> {
    await this.diffusion.dispose();
  }
}

/** Internal spec for `produceClip` — everything one clip needs to render its
 *  frames, independent of whether it came from `generate` or a storyboard shot. */
interface ClipSpec {
  frameCount: number;
  promptEmbedding: Float32Array;
  negativeEmbedding: Float32Array | null;
  timesteps: number[];
  guidance: number;
  coherenceMode: CoherenceMode;
  coherenceStrength: number;
  seed: number;
  motionAmount: number;
  imgToImgStrength: number;
  /** Restart img2img recursion from fresh noise every N keyframes (0 = never). */
  anchorRefreshInterval: number;
  cameraMotion?: { dx: number; dy: number; zoom?: number };
  interpolationFactor: number;
  interpolationBackend: InterpolationBackend;
  width: number;
  height: number;
  /** Progress-label prefix, e.g. "Frame" or "Shot 2". */
  label: string;
  /** Global frame index base, so `onFrame` indices are unique across shots. */
  frameOffset: number;
  onProgress?: (label: string) => void;
  onFrame?: GenerateOptions['onFrame'];
  signal?: AbortSignal;
}

/** Output of `produceClip` / `refinementPass` — frames in output order plus
 *  each frame's clean latent (consumed by the refinement pass). A `null` latent
 *  marks a frame with no true latent (a MOTION-backend tween, whose pixels are
 *  an optical-flow warp, not a decode): the refinement pass carries such frames
 *  through unchanged rather than re-rendering them from a stand-in latent. */
interface ProducedClip {
  frames: ImageBitmap[];
  muxFrames: MuxFrame[];
  latents: (Float32Array | null)[];
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return DEFAULT_MOTION_AMOUNT;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Close every bitmap in a produced clip — used to release a discarded
 *  validation-retry attempt's GPU-backed handles. Idempotent per bitmap. */
function closeClip(clip: ProducedClip): void {
  for (const bm of clip.frames) {
    try { bm.close(); } catch { /* already closed */ }
  }
}

/** Normalise an interpolation factor to an integer ≥ 1 (1 = no interpolation). */
function normaliseFactor(factor: number | undefined): number {
  if (factor === undefined || !Number.isFinite(factor)) return 1;
  return Math.max(1, Math.floor(factor));
}

/** Normalise an anchor-refresh interval to an integer ≥ 0 (0 = never refresh). */
function normaliseRefreshInterval(interval: number | undefined): number {
  if (interval === undefined || !Number.isFinite(interval) || interval <= 0) return 0;
  return Math.floor(interval);
}

/**
 * Encode raw RGBA pixels to a JPEG `data:` URL for the VLM validator. Uses
 * OffscreenCanvas (available in browser + workers). Returns null when the
 * environment has no canvas — the validator is advisory, so the caller skips.
 */
async function rgbaToDataUrl(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

function deriveR2Base(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/$/, '')}/api/studio/weights`;
}

/**
 * Honour the consumer-requested step count while staying on the model's
 * trained timestep schedule. Picks `steps` indices evenly across the
 * descriptor's default schedule so 2-step LCM still hits useful timesteps.
 */
function trimTimesteps(defaults: number[], steps: number): number[] {
  if (steps >= defaults.length) return defaults;
  if (steps <= 1) return [defaults[0]];
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const idx = Math.round((i * (defaults.length - 1)) / (steps - 1));
    out.push(defaults[idx]);
  }
  return out;
}

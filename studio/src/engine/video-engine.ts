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
  CoherenceMode,
  GenerateOptions,
  GenerateResult,
  MambaStateSnapshot,
  VideoEngineOptions,
  WeightSource,
} from '../types';
import { probeDevice } from './device-router';
import { DiffusionEngine, MODEL_REGISTRY, reportProgress } from './diffusion-engine';
import {
  advanceState,
  applyToLatent,
  applyToPrompt,
  blendNoise,
  emptyState,
  shiftLatent,
  shouldApplyLatentResidualBias,
} from './mamba-coherence';
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
   * Generate one video clip. Per-frame work is sequential (frames depend on
   * the previous frame's Mamba state). Returns the muxed MP4 plus the updated
   * state — caller can persist the state for follow-up generations.
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

    const timesteps = trimTimesteps(descriptor.defaultTimesteps, steps);
    const motionAmount = clamp01(args.motionAmount ?? DEFAULT_MOTION_AMOUNT);
    const imgToImgStrength = clamp01(args.imgToImgStrength ?? 0);
    const cameraMotion = args.cameraMotion;
    const latentH = height / 8;
    const latentW = width / 8;

    // One anchor latent for the whole clip; each frame blends fresh noise into
    // it via blendNoise(). Sampling i.i.d. noise per frame (the previous code)
    // produced visually unrelated stills — each frame is a totally fresh
    // interpretation of the same prompt because diffusion is dominated by
    // initial noise. The anchor locks colors and composition across frames;
    // motionAmount controls how much per-frame variation is allowed on top.
    // The latentWalkSharesAnchor regression test locks this — do not go back
    // to sampling fresh noise per frame here.
    const anchorLatent = this.diffusion.sampleInitialLatent(seed);

    // Img2img recursion: when imgToImgStrength > 0, frames N+1+ start from
    // frame N's clean latent (optionally shifted by cameraMotion to simulate
    // camera movement) re-noised partway through the schedule. This is the
    // only path inside the existing model weights that produces actual
    // scene PROGRESSION (camera moving, content flowing) rather than just
    // "same shot wobbling" that the pure anchor-walk delivers.
    let prevLatent: Float32Array | null = null;

    const frames: ImageBitmap[] = [];
    const muxFrames: MuxFrame[] = [];
    // Only kept when a refinement pass is wired — saves the per-frame clean
    // latent so model B can re-noise + partial-denoise it without ever doing
    // a (currently un-shipped) VAE encode of the decoded pixels.
    const draftLatents: Float32Array[] = [];

    for (let frameIdx = 0; frameIdx < args.frames; frameIdx++) {
      if (args.signal?.aborted) {
        throw new DOMException('Generation aborted', 'AbortError');
      }

      const conditionedPrompt =
        coherenceMode === 'prompt-bias'
          ? applyToPrompt({
              ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
              promptEmbedding,
              seqLen: descriptor.sequenceLength,
              embedDim: descriptor.textEmbedDim,
            })
          : promptEmbedding;

      const useImg2Img = imgToImgStrength > 0 && prevLatent !== null;
      let latent: Float32Array;
      let frameTimesteps: number[];
      if (useImg2Img) {
        // Carry frame N's clean latent forward, optionally pan it for camera
        // motion, then re-noise to a partial timestep so the remaining
        // denoise iterations refine (not redraw) the scene.
        const shifted = cameraMotion
          ? shiftLatent(
              prevLatent!,
              { channels: 4, height: latentH, width: latentW },
              cameraMotion.dx,
              cameraMotion.dy,
            )
          : prevLatent!;
        const skipCount = Math.floor(timesteps.length * (1 - imgToImgStrength));
        const truncated = timesteps.slice(skipCount);
        frameTimesteps = truncated.length > 0 ? truncated : [timesteps[timesteps.length - 1]];
        latent = this.diffusion.addNoiseToLatent(
          shifted,
          frameTimesteps[0],
          seed + frameIdx,
        );
      } else {
        const frameNoise = this.diffusion.sampleInitialLatent(seed + 1 + frameIdx);
        latent = blendNoise(anchorLatent, frameNoise, motionAmount);
        frameTimesteps = timesteps;
      }
      // Gate via the shared helper so the rule has one source of truth and
      // is unit-testable. See `shouldApplyLatentResidualBias` for the why.
      if (shouldApplyLatentResidualBias(coherenceMode, useImg2Img)) {
        latent = applyToLatent({
          ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
          latent,
        });
      }

      reportProgress(
        `Frame ${frameIdx + 1}/${args.frames}: ${useImg2Img ? `img2img (${frameTimesteps.length}/${timesteps.length} steps)` : 'denoising'}…`,
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
          reportProgress(
            `Frame ${frameIdx + 1}/${args.frames}: denoise step ${step}/${total}…`,
            onProgress,
          ),
      });
      prevLatent = finalLatent;

      reportProgress(`Frame ${frameIdx + 1}/${args.frames}: decoding VAE…`, onProgress);
      const rgba = pixelsToRgba(pixels, width, height);
      const imageData = new ImageData(
        rgba as Uint8ClampedArray<ArrayBuffer>,
        width,
        height,
      );
      const bitmap = await createImageBitmap(imageData);

      this.mambaState = advanceState(this.mambaState, pixels);

      frames.push(bitmap);
      muxFrames.push({ rgba });
      // Cache the clean latent for the refinement pass — model B's UNet can
      // act on it directly because SD1.5-family models share a VAE latent
      // space. Skip when refinement is off (saves ~64 KB per frame).
      if (this.opts.refinementModel) {
        draftLatents.push(new Float32Array(finalLatent));
      }
      args.onFrame?.(frameIdx, bitmap, this.mambaState);
    }

    // Two-pass refinement: if a refinementModel was wired at create time,
    // swap to it (dispose draft engine → load refinement engine → re-noise
    // each draft latent and run partial denoise through the refinement UNet).
    // VRAM stays at max(draft, refinement) not draft+refinement because the
    // swap is sequential. Only safe across SD1.5-family models (shared VAE
    // latent space) — enforced at the quality-tier preset level.
    let refinedFrames: ImageBitmap[] | null = null;
    let refinedMuxFrames: MuxFrame[] | null = null;
    if (this.opts.refinementModel && this.opts.refinementModel !== this.opts.model) {
      const refinementStrength = clamp01(args.refinementStrength ?? DEFAULT_REFINEMENT_STRENGTH);
      reportProgress(
        `Refinement pass: swapping ${this.opts.model} → ${this.opts.refinementModel} (sequential, no VRAM cost)…`,
        onProgress,
      );
      await this.diffusion.dispose();
      this.diffusion = new DiffusionEngine({
        model: this.opts.refinementModel,
        probed: this.probed,
        apiKey: this.opts.apiKey,
        weightSources: this.opts.weightSources ?? DEFAULT_WEIGHT_SOURCES,
        r2Base: deriveR2Base(this.opts.baseUrl),
        width,
        height,
        onProgress,
      });
      await this.diffusion.init();
      // Re-embed the prompt under the refinement model's text encoder.
      // (LCM family is consistent on dims, but the encoder weights differ.)
      const refinedCondEmbedding = await this.diffusion.embedPrompt(resolvedPrompt);
      const refinedDescriptor = MODEL_REGISTRY[this.opts.refinementModel];
      const refinedTimesteps = trimTimesteps(refinedDescriptor.defaultTimesteps, refinedDescriptor.defaultSteps);
      const skipCount = Math.floor(refinedTimesteps.length * (1 - refinementStrength));
      const partialTimesteps =
        skipCount < refinedTimesteps.length
          ? refinedTimesteps.slice(skipCount)
          : [refinedTimesteps[refinedTimesteps.length - 1]];

      refinedFrames = [];
      refinedMuxFrames = [];
      for (let i = 0; i < draftLatents.length; i++) {
        if (args.signal?.aborted) {
          throw new DOMException('Generation aborted', 'AbortError');
        }
        reportProgress(`Refinement pass: frame ${i + 1}/${draftLatents.length}…`, onProgress);
        const noised = this.diffusion.addNoiseToLatent(draftLatents[i], partialTimesteps[0], seed + i);
        const { pixels: refinedPixels } = await this.diffusion.denoise({
          latent: noised,
          condEmbedding: refinedCondEmbedding,
          uncondEmbedding: null,
          timesteps: partialTimesteps,
          guidance: refinedDescriptor.defaultGuidance,
          seed: seed + i,
        });
        const refinedRgba = pixelsToRgba(refinedPixels, width, height);
        const refinedImageData = new ImageData(
          refinedRgba as Uint8ClampedArray<ArrayBuffer>,
          width,
          height,
        );
        const refinedBitmap = await createImageBitmap(refinedImageData);
        refinedFrames.push(refinedBitmap);
        refinedMuxFrames.push({ rgba: refinedRgba });
        args.onFrame?.(i, refinedBitmap, this.mambaState);
      }
      // Close the draft bitmaps now that we have the refined replacements —
      // they're GPU-backed handles, not cheap. Without this each two-pass
      // run leaks ~bitmaps × resolution² bytes until the engine disposes.
      for (const bm of frames) {
        try { bm.close(); } catch { /* already closed */ }
      }
      reportProgress(`Refinement pass complete (${draftLatents.length} frames refined).`, onProgress);
    }

    const finalFrames = refinedFrames ?? frames;
    const finalMuxFrames = refinedMuxFrames ?? muxFrames;

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

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return DEFAULT_MOTION_AMOUNT;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
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

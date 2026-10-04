/**
 * DiffusionEngine — hybrid ORT + transformers.js denoising pipeline.
 *
 * Layered architecture:
 *   • transformers.js (extension layer) — owns the CLIP BPE tokenizer. We do
 *     NOT hand-roll BPE.
 *   • raw onnxruntime-web (base layer) — owns the text-encoder, UNet and
 *     VAE-decoder sessions. We keep direct control here so Mamba latent-residual
 *     coherence can inject biases between scheduler steps without going
 *     through an opaque pipeline wrapper.
 *
 * This module is the SESSION OWNER only. What it composes lives beside it:
 *   • `diffusion-models.ts`   — the model registry (pure data)
 *   • `diffusion-schedule.ts` — DDPM schedule, noise, the LCM step (pure math)
 *   • `ort-session.ts`        — tensor typing, session options, error translation
 *   • `progress.ts` / `abort.ts` — the shared progress sink and cancel check
 *
 * The shared denoise() primitive runs an LCM-style consistency-model step
 * that works for both backbones — SD-Turbo with timesteps=[999] degrades to
 * the standard single-step formulation, LCM with timesteps=[999,759,519,259]
 * uses the same formula 4× with the right alpha schedule.
 */

import * as ort from 'onnxruntime-web';
import { AutoTokenizer, type PreTrainedTokenizer } from '@huggingface/transformers';
import type { ActiveDevice, DiffusionModelId, LcmModelDescriptor, OnnxFile, WeightSource } from '../types';
import type { ProbedDevice } from './device-router';
import { getOrFetchWeight } from './weight-cache';
import { MODEL_REGISTRY } from './diffusion-models';
import {
  applyGuidance,
  forwardDiffuse,
  gaussianNoise,
  lcmGuidanceCondEmbedding,
  lcmStep,
  noiseScaleAt,
} from './diffusion-schedule';
import {
  assertSessionMatchesSpec,
  basename,
  buildOrtSessionOptions,
  checkMemoryForModel,
  explainOrtError,
  materializeTensor,
  pickFirstFloat32,
  type RawTensor,
} from './ort-session';
import { reportProgress } from './progress';
import { throwIfAborted } from './abort';

// ---------------------------------------------------------------------------
// UNet input builders — single registry of "this is how you compute each
// declared input." A model whose `unetInputs` references a name not in
// this registry fails the [contract unit test](./diffusion-engine.test.ts),
// catching the missing-feed regression before it can throw at runtime.
// ---------------------------------------------------------------------------

interface UnetInputContext {
  // UNet feed-building is an lcm-diffusion-only concern (webdit's DiT graph
  // has its own, entirely different I/O contract — see BUNDLE_IO in
  // @webdit/shared) — narrowed rather than the full ModelDescriptor union so
  // the builders below can read LCM-only fields without a guard.
  descriptor: LcmModelDescriptor;
  sample: Float32Array;
  condEmbedding: Float32Array;
  timestep: number;
  guidance: number;
  latentShape: [number, number, number, number];
}

type UnetInputBuilder = (ctx: UnetInputContext) => RawTensor;

const UNET_INPUT_BUILDERS: Record<string, UnetInputBuilder> = {
  sample: (ctx) => ({ data: ctx.sample, shape: ctx.latentShape }),
  timestep: (ctx) => ({ data: Float32Array.from([ctx.timestep]), shape: [1] }),
  encoder_hidden_states: (ctx) => ({
    data: ctx.condEmbedding,
    shape: [1, ctx.descriptor.sequenceLength, ctx.descriptor.textEmbedDim],
  }),
  timestep_cond: (ctx) => ({
    // LCM consistency-model guidance-scale embedding. The embedded scale is the
    // model's DISTILLATION guidance scale (descriptor.lcmGuidanceScale, diffusers
    // default 8.5), NOT the runtime cond/uncond mix `ctx.guidance` (~1 for LCM).
    // Embedding the mix scale gave w = 1 - 1 = 0 → a degenerate all-[sin0=0,cos0=1]
    // vector, conditioning the UNet as if guidance≈1 and producing washed,
    // out-of-range latents on the refinement pass. See lcmGuidanceCondEmbedding.
    data: lcmGuidanceCondEmbedding(ctx.descriptor),
    shape: [1, ctx.descriptor.lcmGuidanceEmbedDim ?? 256],
  }),
};

/** Names the engine knows how to build. Exported so the registry contract test
 *  can assert every model's `unetInputs` references a known name. */
export const KNOWN_UNET_INPUTS: ReadonlySet<string> = new Set(
  Object.keys(UNET_INPUT_BUILDERS),
);

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface DiffusionEngineOptions {
  model: DiffusionModelId;
  probed: ProbedDevice;
  apiKey: string;
  weightSources: WeightSource[];
  r2Base?: string;
  width: number;
  height: number;
  onWeightProgress?: (file: string, loaded: number, total: number | null) => void;
  /** Phase progress (downloads, session creation, denoise steps). */
  onProgress?: (label: string) => void;
}

export interface DenoiseInputs {
  /** Initial latent of shape [1, 4, height/8, width/8]. Not mutated. */
  latent: Float32Array;
  /** Text-conditioning embedding [1, seqLen, embedDim]. */
  condEmbedding: Float32Array;
  /** Negative-prompt embedding for CFG (when guidance > 0). Pass null for guidance=0. */
  uncondEmbedding: Float32Array | null;
  /** Override the model's default timestep schedule. Pass null to use defaults. */
  timesteps?: number[];
  /** Override classifier-free guidance scale. */
  guidance: number;
  /** Seed used for stochastic LCM noise injection between steps. */
  seed: number;
  /** Cancels BETWEEN UNet steps — a multi-second step at high resolution no
   *  longer has to finish the whole frame before a Stop takes effect. */
  signal?: AbortSignal;
  /** Optional per-step progress callback ("denoise step 2/4 for frame 3/24"). */
  onStep?: (step: number, totalSteps: number) => void;
}

export interface DenoiseResult {
  /** Final decoded RGB pixel data, [-1..1] range, layout [3, height, width]. */
  pixels: Float32Array;
  /** Final clean (post-last-step) latent before VAE decode. Used by VideoEngine
   *  for img2img recursion — frame N+1 starts from this latent re-noised partway
   *  through the schedule instead of from fresh anchor noise. */
  latent: Float32Array;
}

interface SessionBuffers {
  label: string;
  modelBuf: ArrayBuffer;
  externalData: { name: string; buf: ArrayBuffer } | null;
}

/**
 * How many distinct prompt embeddings an engine remembers. A storyboard reuses
 * its negative prompt on every shot and often repeats a shot prompt; the CLIP
 * text encoder is a full ORT session run each time, so a small memo removes
 * those repeats while holding at most ~3 MB (8 × 77 × 1024 floats).
 */
const PROMPT_EMBEDDING_CACHE_SIZE = 8;

export class DiffusionEngine {
  private tokenizer: PreTrainedTokenizer | null = null;
  private textEncoderSession: ort.InferenceSession | null = null;
  private unetSession: ort.InferenceSession | null = null;
  private vaeSession: ort.InferenceSession | null = null;
  private disposed = false;
  /** Insertion-ordered, so the first key is the least recently used. */
  private readonly promptEmbeddings = new Map<string, Float32Array>();

  constructor(private readonly opts: DiffusionEngineOptions) {}

  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    const d = this.descriptor;
    const sessionOptions = buildOrtSessionOptions(this.opts.probed.kind);
    const onProgress = this.opts.onProgress;

    // Fail fast before downloading 1.7GB if the device clearly can't run it.
    const memoryError = checkMemoryForModel(
      this.opts.probed.approxMemoryMb,
      d.minVramMb,
      d.id,
    );
    if (memoryError) {
      throw new Error(memoryError);
    }

    // Listen for GPU device loss (Windows D3D12 TDR, OS driver reset, etc).
    // The lost-promise fires once; we report it through the same progress
    // channel so the user sees a clear "GPU device lost" message instead of
    // a silent stall.
    if (this.opts.probed.kind === 'webgpu' && this.opts.probed.gpuDevice) {
      this.opts.probed.gpuDevice.lost
        .then((info) => {
          reportProgress(
            `GPU device LOST (${info.reason}): ${info.message}. ` +
              `Reload the page; pick a lower resolution or lighter model on retry.`,
            onProgress,
          );
        })
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .catch(() => {});
    }

    try {
      reportProgress(`Loading CLIP tokenizer (${d.tokenizerRepo})…`, onProgress);
      this.tokenizer = await AutoTokenizer.from_pretrained(d.tokenizerRepo);
      reportProgress('Tokenizer ready.', onProgress);

      reportProgress(`Loading ${d.id} weights (UNet + text-encoder + VAE)…`, onProgress);

      // Phase 1: download all model + sidecar weights in parallel (network-bound).
      const downloads = await Promise.all([
        this.fetchSessionBuffers(d.files.textEncoder, 'text_encoder'),
        this.fetchSessionBuffers(d.files.unet, 'unet'),
        this.fetchSessionBuffers(d.files.vaeDecoder, 'vae_decoder'),
      ]);

      // Phase 2: create ORT sessions SERIALLY. ORT-web mounts external-data
      // sidecars on a GLOBAL Map (`f.Xc`) on the wasm Module, and the `finally`
      // block of every session create calls `unmountExternalData()` which wipes
      // that map. Three concurrent `Promise.all` creates with sidecars therefore
      // race: the first session's finally wipes the data the second is still
      // mid-deserialize. Symptom is "Module.MountedFiles is not available" on a
      // tensor like `up_blocks.2.resnets.1.conv2.weight`.
      // The runSessionCreatesSequentially regression test in diffusion-engine.test.ts
      // locks this invariant — do not switch back to Promise.all here.
      this.textEncoderSession = await this.createSessionFromBuffers(downloads[0], sessionOptions);
      this.unetSession = await this.createSessionFromBuffers(downloads[1], sessionOptions);
      this.vaeSession = await this.createSessionFromBuffers(downloads[2], sessionOptions);
      reportProgress('All ORT sessions created.', onProgress);

      // Validate the loaded models' input names match what the registry declares.
      // Catches model-vs-registry drift at init time with a clear error instead
      // of an opaque "input 'X' is missing in 'feeds'" on the first run.
      assertSessionMatchesSpec('unet', this.unetSession, d.unetInputs);
      assertSessionMatchesSpec('text_encoder', this.textEncoderSession, d.textEncoderInputs);
      reportProgress('Model graph contract verified — engine ready.', onProgress);
    } catch (err) {
      // A failed init used to leave whichever sessions DID get created holding
      // their WASM heap + GPU buffers until the caller disposed an engine it
      // never got to use. Release them here so a failed attempt (OOM on the
      // UNet, a contract mismatch) leaves memory as it found it, and the user's
      // retry with a lighter model gets the whole budget.
      await this.releaseSessions();
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /**
   * Release ORT sessions + destroy the engine's GPU device. Idempotent and
   * safe to await even on a never-fully-init'd engine. After dispose() the
   * engine cannot be reused — create a new one.
   *
   * ORT sessions hold large WASM heaps + WebGPU buffers (the LCM UNet
   * alone is ~1.7 GB). Without release(), those stay allocated even after
   * the React tree unmounts — exactly the leak the user surfaced.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    await this.releaseSessions();

    // GPUDevice owns the WebGPU command queue + uploaded weights buffers.
    // destroy() is sync, idempotent, and releases everything immediately.
    if (this.opts.probed.kind === 'webgpu' && this.opts.probed.gpuDevice) {
      try {
        this.opts.probed.gpuDevice.destroy();
      } catch {
        // device may already be lost (TDR) — destroy is a no-op then
      }
    }
  }

  /**
   * `DiffusionEngine` only ever implements the lcm-diffusion frame-by-frame
   * primitives (embed/denoise/decode) — a webdit-dit model is never handed
   * to this class (VideoEngine.create dispatches those to webdit-engine.ts
   * instead). Narrowing here, once, means every other method on this class
   * can read LCM-only fields (`hfRepo`, `unetInputs`, `files`, …) without
   * repeating the guard.
   */
  get descriptor(): LcmModelDescriptor {
    const d = MODEL_REGISTRY[this.opts.model];
    if (d.engine !== 'lcm-diffusion') {
      throw new Error(
        `DiffusionEngine only supports lcm-diffusion models; got '${d.id}' (engine: ${d.engine}). ` +
          `webdit-dit models are handled by webdit-engine.ts / VideoEngine's webdit dispatch.`,
      );
    }
    return d;
  }

  get activeDevice(): ActiveDevice {
    return this.opts.probed.kind;
  }

  /** Tokenise (transformers.js) then run the CLIP text encoder (raw ORT) →
   *  conditioning embedding [1, seqLen, embedDim]. Memoised per prompt (see
   *  {@link PROMPT_EMBEDDING_CACHE_SIZE}); every call returns its own copy, so a
   *  caller that blends or biases the embedding cannot corrupt the cache. */
  async embedPrompt(prompt: string): Promise<Float32Array> {
    const cached = this.promptEmbeddings.get(prompt);
    if (cached) {
      // Refresh recency: re-inserting moves the key to the end of the Map.
      this.promptEmbeddings.delete(prompt);
      this.promptEmbeddings.set(prompt, cached);
      return new Float32Array(cached);
    }
    const embedding = await this.encodePrompt(prompt);
    this.promptEmbeddings.set(prompt, embedding);
    if (this.promptEmbeddings.size > PROMPT_EMBEDDING_CACHE_SIZE) {
      const oldest = this.promptEmbeddings.keys().next().value;
      if (oldest !== undefined) this.promptEmbeddings.delete(oldest);
    }
    return new Float32Array(embedding);
  }

  /** Sample a fresh latent from deterministic gaussian noise. */
  sampleInitialLatent(seed: number): Float32Array {
    return gaussianNoise(this.latentLength, seed);
  }

  /**
   * Shared denoise primitive for both LCM and SD-Turbo. Uses the LCMScheduler
   * consistency-model step formula at the chosen timesteps; SD-Turbo with
   * timesteps=[999] degenerates to a single step that's equivalent to its
   * native one-shot generation up to a small numerical constant.
   */
  async denoise(inputs: DenoiseInputs): Promise<DenoiseResult> {
    if (!this.unetSession || !this.vaeSession) {
      throw new Error('DiffusionEngine.init() not called');
    }
    this.assertDenoiseInputs(inputs);

    const { latentH, latentW } = this.latentDims;
    const latentShape: [number, number, number, number] = [1, 4, latentH, latentW];

    const timesteps = inputs.timesteps ?? this.descriptor.defaultTimesteps;
    // One working buffer for the whole run — lcmStep updates it in place.
    const sample = new Float32Array(inputs.latent);

    for (let i = 0; i < timesteps.length; i++) {
      throwIfAborted(inputs.signal);
      inputs.onStep?.(i + 1, timesteps.length);
      const t = timesteps[i]!;

      const noisePred = await this.runUnet({
        sample,
        condEmbedding: inputs.condEmbedding,
        uncondEmbedding: inputs.uncondEmbedding,
        timestep: t,
        guidance: inputs.guidance,
        latentShape,
      });

      const next = i < timesteps.length - 1 ? timesteps[i + 1]! : null;
      lcmStep(sample, noisePred, t, next, inputs.seed, i);
    }

    throwIfAborted(inputs.signal);
    const pixels = await this.runVaeDecode(sample, latentH, latentW);
    return { pixels, latent: sample };
  }

  /**
   * Forward-noise a clean latent to the noise level corresponding to `timestep`.
   * Used by VideoEngine's img2img recursion: take the previous frame's clean
   * latent, re-noise it to a partial-schedule timestep, then run the remaining
   * denoise steps. Result is scene-content carried forward + prompt-driven
   * evolution, instead of "fresh interpretation per frame".
   *
   *   noised = sqrt(alpha_cumprod[t]) * clean + sqrt(1 - alpha_cumprod[t]) * noise
   *
   * — the standard DDPM forward diffusion at timestep t.
   */
  addNoiseToLatent(clean: Float32Array, timestep: number, seed: number): Float32Array {
    return forwardDiffuse(clean, timestep, seed);
  }

  /**
   * The noise fraction `sqrt(1 - ᾱ_t)` of a latent re-noised to `timestep` via
   * the shared DDPM schedule — i.e. the coefficient on the noise term in
   * `addNoiseToLatent`. Exposed so the coherence layer can scale the
   * latent-residual Mamba bias by the same noise level the engine actually
   * injected, letting that bias compose with img2img recursion (see
   * `latentResidualBiasScale`). Single source of truth for the schedule.
   */
  noiseScaleForTimestep(timestep: number): number {
    return noiseScaleAt(timestep);
  }

  /**
   * VAE-decode a clean latent to RGB pixels ([-1..1], layout [3, h, w]) WITHOUT
   * running the UNet denoise loop. This is the cheap half of `denoise()` and is
   * what makes keyframe interpolation worthwhile: the FrameInterpolator slerps
   * two keyframe latents into a tween latent, and the engine turns that tween
   * into a frame with one VAE decode instead of a full multi-step denoise.
   */
  async decodeLatent(latent: Float32Array): Promise<Float32Array> {
    if (!this.vaeSession) {
      throw new Error('DiffusionEngine.init() not called');
    }
    if (latent.length !== this.latentLength) {
      throw new Error(
        `decodeLatent: latent length ${latent.length} != expected ${this.latentLength} ` +
          `for ${this.opts.width}x${this.opts.height}.`,
      );
    }
    const { latentH, latentW } = this.latentDims;
    return this.runVaeDecode(latent, latentH, latentW);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private get latentDims(): { latentH: number; latentW: number } {
    return { latentH: this.opts.height / 8, latentW: this.opts.width / 8 };
  }

  /** Elements in one [1, 4, h/8, w/8] latent. */
  private get latentLength(): number {
    const { latentH, latentW } = this.latentDims;
    return 4 * latentH * latentW;
  }

  /**
   * Shape-check the denoise feeds BEFORE the first UNet run. A latent made at
   * another resolution, or an embedding from another backbone (768-wide SD1.5
   * vs 1024-wide SD2.1), otherwise surfaces as ORT's opaque "invalid
   * dimensions" from deep inside the WASM runtime.
   */
  private assertDenoiseInputs(inputs: DenoiseInputs): void {
    if (inputs.latent.length !== this.latentLength) {
      throw new Error(
        `denoise: latent length ${inputs.latent.length} != expected ${this.latentLength} ` +
          `for ${this.opts.width}x${this.opts.height}.`,
      );
    }
    const { sequenceLength, textEmbedDim, id } = this.descriptor;
    const embedLength = sequenceLength * textEmbedDim;
    const embeddings: Array<[string, Float32Array | null]> = [
      ['condEmbedding', inputs.condEmbedding],
      ['uncondEmbedding', inputs.uncondEmbedding],
    ];
    for (const [name, embedding] of embeddings) {
      if (embedding && embedding.length !== embedLength) {
        throw new Error(
          `denoise: ${name} length ${embedding.length} != expected ${embedLength} ` +
            `([1, ${sequenceLength}, ${textEmbedDim}] for ${id}) — was it embedded by a different model?`,
        );
      }
    }
  }

  /** Release every ORT session, the tokenizer and the prompt memo. Shared by
   *  dispose() and the init() failure path; safe on a partially-built engine. */
  private async releaseSessions(): Promise<void> {
    const sessions = [this.textEncoderSession, this.unetSession, this.vaeSession];
    this.textEncoderSession = null;
    this.unetSession = null;
    this.vaeSession = null;
    this.tokenizer = null;
    this.promptEmbeddings.clear();

    await Promise.all(
      sessions.map(async (s) => {
        if (!s) return;
        try {
          await s.release();
        } catch {
          // release() can throw if the session was never fully created;
          // we still want to continue tearing down the other resources.
        }
      }),
    );
  }

  /** The uncached text-encoder pass behind {@link embedPrompt}. */
  private async encodePrompt(prompt: string): Promise<Float32Array> {
    if (!this.tokenizer || !this.textEncoderSession) {
      throw new Error('DiffusionEngine.init() not called');
    }
    const { textEmbedDim, sequenceLength } = this.descriptor;

    const encoded = await this.tokenizer(prompt, {
      padding: 'max_length',
      max_length: sequenceLength,
      truncation: true,
    });

    // Build input_ids with the dtype declared for THIS model's text encoder
    // (int32 for most diffusers exports, but int64 for some — drift surfaces as
    // "Unexpected input data type" without the per-model declaration).
    const rawIds = encoded.input_ids.data as ArrayLike<bigint | number>;
    const idFloats = new Float32Array(sequenceLength);
    for (let i = 0; i < sequenceLength; i++) {
      idFloats[i] = i < rawIds.length ? Number(rawIds[i]) : 0;
    }
    const inputIdsSpec = this.descriptor.textEncoderInputs.find((s) => s.name === 'input_ids');
    if (!inputIdsSpec) {
      throw new Error(`Model '${this.descriptor.id}' textEncoderInputs missing 'input_ids' spec.`);
    }
    const idTensor = materializeTensor(inputIdsSpec.dtype, {
      data: idFloats,
      shape: [1, sequenceLength],
    });

    const out = await this.runSession(
      this.textEncoderSession,
      { [inputIdsSpec.name]: idTensor },
      'text_encoder',
    );
    const hidden = (out.last_hidden_state?.data as Float32Array | undefined) ?? pickFirstFloat32(out);
    if (!hidden) {
      throw new Error('Text encoder returned no Float32 output');
    }
    if (hidden.length !== sequenceLength * textEmbedDim) {
      throw new Error(
        `Text encoder dim mismatch: expected ${sequenceLength * textEmbedDim}, got ${hidden.length}. ` +
          `Check ${this.descriptor.hfRepo} text_encoder config.`,
      );
    }
    return new Float32Array(hidden);
  }

  /** Fetch the model + (optional) external-data buffers for one session.
   *  Pure I/O — no ORT calls. Split from session creation so the engine can
   *  parallelize downloads while still serialising the ORT create step. */
  private async fetchSessionBuffers(
    file: OnnxFile,
    label: string,
  ): Promise<SessionBuffers> {
    const onProgress = this.opts.onProgress;
    reportProgress(`Downloading ${label} (${file.model})…`, onProgress);
    const modelBuf = await this.fetchWeight(file.model);
    let externalData: { name: string; buf: ArrayBuffer } | null = null;
    if (file.externalData) {
      reportProgress(`Downloading ${label} weight data (${file.externalData})…`, onProgress);
      const dataBuf = await this.fetchWeight(file.externalData);
      externalData = { name: basename(file.externalData), buf: dataBuf };
    }
    return { label, modelBuf, externalData };
  }

  /** Create an ORT session from already-downloaded buffers. Caller MUST call
   *  this serially across sessions when any of them carry external data —
   *  ORT-web's external-data mount Map is global and the `finally` of every
   *  session create unmounts it, so concurrent creates race. The init() call
   *  site enforces serial creation. */
  private async createSessionFromBuffers(
    bufs: SessionBuffers,
    baseOptions: ort.InferenceSession.SessionOptions,
  ): Promise<ort.InferenceSession> {
    const onProgress = this.opts.onProgress;
    const options: ort.InferenceSession.SessionOptions = { ...baseOptions };
    if (bufs.externalData) {
      // The .onnx graph references its sidecar by basename (e.g.
      // 'model.onnx_data'); ORT matches the externalData `path` against it.
      options.externalData = [
        { path: bufs.externalData.name, data: new Uint8Array(bufs.externalData.buf) },
      ];
    }
    reportProgress(`Creating ${bufs.label} ORT session…`, onProgress);
    try {
      const session = await ort.InferenceSession.create(
        new Uint8Array(bufs.modelBuf),
        options,
      );
      reportProgress(`${bufs.label} ready.`, onProgress);
      return session;
    } catch (err) {
      throw explainOrtError(
        err,
        `${bufs.label} session create`,
        this.descriptor.id,
        this.descriptor.minVramMb,
        this.opts.probed.approxMemoryMb,
      );
    }
  }

  /** Wrap session.run() so DXGI_ERROR_DEVICE_HUNG, std::bad_alloc, "Device is
   *  lost", and similar runtime ORT failures become actionable messages
   *  instead of raw WebGPU stack traces. Single sink — every session.run
   *  call in the engine goes through here. */
  private async runSession(
    session: ort.InferenceSession,
    feeds: Record<string, ort.Tensor>,
    label: string,
  ): Promise<ort.InferenceSession.OnnxValueMapType> {
    try {
      return await session.run(feeds);
    } catch (err) {
      throw explainOrtError(
        err,
        `${label} session run`,
        this.descriptor.id,
        this.descriptor.minVramMb,
        this.opts.probed.approxMemoryMb,
      );
    }
  }

  private async fetchWeight(file: string): Promise<ArrayBuffer> {
    return getOrFetchWeight({
      cacheKey: `${this.opts.model}/${file}`,
      hfRepo: this.descriptor.hfRepo,
      hfPath: file,
      sources: this.opts.weightSources,
      apiKey: this.opts.apiKey,
      r2Base: this.opts.r2Base,
      onProgress: (loaded, total) => this.opts.onWeightProgress?.(file, loaded, total),
    });
  }

  private buildUnetFeeds(args: {
    sample: Float32Array;
    condEmbedding: Float32Array;
    timestep: number;
    guidance: number;
    latentShape: [number, number, number, number];
  }): Record<string, ort.Tensor> {
    const ctx: UnetInputContext = { descriptor: this.descriptor, ...args };
    const feeds: Record<string, ort.Tensor> = {};
    for (const spec of this.descriptor.unetInputs) {
      const builder = UNET_INPUT_BUILDERS[spec.name];
      if (!builder) {
        throw new Error(
          `Model '${this.descriptor.id}' declares UNet input '${spec.name}' but no builder is registered. ` +
            `Add it to UNET_INPUT_BUILDERS in diffusion-engine.ts.`,
        );
      }
      feeds[spec.name] = materializeTensor(spec.dtype, builder(ctx));
    }
    return feeds;
  }

  private async runUnet(args: {
    sample: Float32Array;
    condEmbedding: Float32Array;
    uncondEmbedding: Float32Array | null;
    timestep: number;
    guidance: number;
    latentShape: [number, number, number, number];
  }): Promise<Float32Array> {
    const session = this.unetSession!;
    const { uncondEmbedding, ...condArgs } = args;
    const condOut = await this.runSession(session, this.buildUnetFeeds(condArgs), 'unet (conditional)');
    const condNoise = pickFirstFloat32(condOut);
    if (!condNoise) throw new Error('UNet returned no Float32 output');

    if (!uncondEmbedding || args.guidance <= 0) {
      return condNoise;
    }

    const uncondOut = await this.runSession(
      session,
      this.buildUnetFeeds({ ...condArgs, condEmbedding: uncondEmbedding }),
      'unet (unconditional)',
    );
    const uncondNoise = pickFirstFloat32(uncondOut);
    if (!uncondNoise) throw new Error('UNet unconditional pass returned no Float32 output');

    // ORT hands back a fresh output buffer per run, so mixing into it in place
    // allocates nothing extra.
    applyGuidance(condNoise, uncondNoise, args.guidance);
    return condNoise;
  }

  private async runVaeDecode(latent: Float32Array, h: number, w: number): Promise<Float32Array> {
    const session = this.vaeSession!;
    const scaled = new Float32Array(latent.length);
    const scale = this.descriptor.vaeScalingFactor;
    for (let i = 0; i < latent.length; i++) scaled[i] = latent[i]! / scale;
    const input = new ort.Tensor('float32', scaled, [1, 4, h, w]);
    const out = await this.runSession(session, { latent_sample: input }, 'vae_decoder');
    const pixels = pickFirstFloat32(out);
    if (!pixels) throw new Error('VAE decoder returned no Float32 output');
    return pixels;
  }
}

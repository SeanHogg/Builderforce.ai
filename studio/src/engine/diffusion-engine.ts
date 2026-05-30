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

import * as ort from 'onnxruntime-web';
import { AutoTokenizer, type PreTrainedTokenizer } from '@huggingface/transformers';
import type {
  ActiveDevice,
  DiffusionModelId,
  ModelDescriptor,
  OnnxFile,
  OrtInputSpec,
  OrtTensorDtype,
  WeightSource,
} from '../types';
import type { ProbedDevice } from './device-router';
import { getOrFetchWeight } from './weight-cache';
import { configureOnnxRuntime } from './onnx-runtime-config';

// Apply shared ONNX runtime config (WASM CDN paths, thread count) once at
// module load. Idempotent — safe to call from multiple modules.
configureOnnxRuntime();

// ---------------------------------------------------------------------------
// Model registry — single source of truth for per-model dims, timesteps,
// VAE scale factors, and ONNX file paths. Every difference between
// LCM-Dreamshaper-v7 and SD-Turbo lives here, not in the denoise loop.
// ---------------------------------------------------------------------------

export const MODEL_REGISTRY: Record<DiffusionModelId, ModelDescriptor> = {
  'lcm-dreamshaper-v7': {
    id: 'lcm-dreamshaper-v7',
    defaultSteps: 4,
    defaultGuidance: 1.0, // LCM works best with CFG ~1
    minVramMb: 6 * 1024,
    hfRepo: 'aislamov/lcm-dreamshaper-v7-onnx',
    tokenizerRepo: 'Xenova/clip-vit-large-patch14',
    textEmbedDim: 768, // SD1.5 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999, 759, 519, 259],
    files: {
      textEncoder: { model: 'text_encoder/model.onnx' },
      unet: { model: 'unet/model.onnx', externalData: 'unet/model.onnx_data' },
      vaeDecoder: { model: 'vae_decoder/model.onnx', externalData: 'vae_decoder/model.onnx_data' },
    },
    // LCM Dreamshaper (aislamov) UNet expects timestep as float32 (NOT int64).
    // Drift here surfaces as: "Unexpected input data type. Actual: int64, expected: float".
    unetInputs: [
      { name: 'sample', dtype: 'float32' },
      { name: 'timestep', dtype: 'float32' },
      { name: 'encoder_hidden_states', dtype: 'float32' },
      { name: 'timestep_cond', dtype: 'float32' },
    ],
    textEncoderInputs: [{ name: 'input_ids', dtype: 'int32' }],
    lcmGuidanceEmbedDim: 256, // standard for LCM-LoRA-derived exports
  },
  'sd-turbo': {
    id: 'sd-turbo',
    defaultSteps: 1,
    defaultGuidance: 0.0, // SD-Turbo is unconditional
    minVramMb: 4 * 1024,
    hfRepo: 'schmuell/sd-turbo-ort-web', // ORT-team browser demo build (single-file ONNX)
    tokenizerRepo: 'Xenova/clip-vit-large-patch14',
    textEmbedDim: 1024, // SD2.1 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999],
    files: {
      textEncoder: { model: 'text_encoder/model.onnx' },
      unet: { model: 'unet/model.onnx' },
      vaeDecoder: { model: 'vae_decoder/model.onnx' },
    },
    // schmuell/sd-turbo-ort-web export uses int64 timestep (standard SD UNet).
    unetInputs: [
      { name: 'sample', dtype: 'float32' },
      { name: 'timestep', dtype: 'int64' },
      { name: 'encoder_hidden_states', dtype: 'float32' },
    ],
    textEncoderInputs: [{ name: 'input_ids', dtype: 'int32' }],
  },
};

// ---------------------------------------------------------------------------
// UNet input builders — single registry of "this is how you compute each
// declared input." A model whose `unetInputNames` references a name not in
// this registry fails the [contract unit test](./diffusion-engine.test.ts),
// catching the missing-feed regression before it can throw at runtime.
// ---------------------------------------------------------------------------

interface UnetInputContext {
  descriptor: ModelDescriptor;
  sample: Float32Array;
  condEmbedding: Float32Array;
  timestep: number;
  guidance: number;
  latentShape: [number, number, number, number];
}

/** A builder produces the raw payload + shape; the engine wraps it in a Tensor
 *  of the descriptor's declared dtype via `materializeTensor`. Splitting "compute
 *  the value" from "type the tensor" lets one builder serve every dtype that
 *  makes sense for that input (e.g. `timestep` is float32 in LCM, int64 in SD). */
interface RawTensor {
  data: Float32Array;
  shape: readonly number[];
}
type UnetInputBuilder = (ctx: UnetInputContext) => RawTensor;

const UNET_INPUT_BUILDERS: Record<string, UnetInputBuilder> = {
  sample: (ctx) => ({ data: ctx.sample, shape: ctx.latentShape }),
  timestep: (ctx) => ({ data: Float32Array.from([ctx.timestep]), shape: [1] }),
  encoder_hidden_states: (ctx) => ({
    data: ctx.condEmbedding,
    shape: [1, ctx.descriptor.sequenceLength, ctx.descriptor.textEmbedDim],
  }),
  timestep_cond: (ctx) => {
    // LCM consistency-model guidance-scale embedding. Diffusers convention:
    // embed (w - 1) where w is the CFG scale. w=1 (LCM default) → all zeros.
    const dim = ctx.descriptor.lcmGuidanceEmbedDim ?? 256;
    return {
      data: guidanceScaleEmbedding(ctx.guidance - 1, dim),
      shape: [1, dim],
    };
  },
};

/** Names the engine knows how to build. Exported so the registry contract test
 *  can assert every model's `unetInputs` references a known name. */
export const KNOWN_UNET_INPUTS: ReadonlySet<string> = new Set(
  Object.keys(UNET_INPUT_BUILDERS),
);

/** Dtypes the engine can materialize. Exported for the registry contract test. */
export const SUPPORTED_DTYPES: ReadonlySet<OrtTensorDtype> = new Set<OrtTensorDtype>([
  'float32',
  'int32',
  'int64',
]);

/** Wrap a Float32Array payload as an ORT Tensor of the requested dtype.
 *  Single conversion site — every dtype change happens here, no duplication. */
export function materializeTensor(
  dtype: OrtTensorDtype,
  raw: RawTensor,
): ort.Tensor {
  const shape = [...raw.shape];
  if (dtype === 'float32') {
    return new ort.Tensor('float32', raw.data, shape);
  }
  if (dtype === 'int32') {
    const out = new Int32Array(raw.data.length);
    for (let i = 0; i < raw.data.length; i++) out[i] = raw.data[i] | 0;
    return new ort.Tensor('int32', out, shape);
  }
  if (dtype === 'int64') {
    const out = new BigInt64Array(raw.data.length);
    for (let i = 0; i < raw.data.length; i++) out[i] = BigInt(raw.data[i] | 0);
    return new ort.Tensor('int64', out, shape);
  }
  // Exhaustive on OrtTensorDtype — adding a new dtype to the type forces this.
  throw new Error(`Unsupported dtype: ${dtype satisfies never}`);
}

/** Sinusoidal guidance-scale embedding (diffusers parity). */
function guidanceScaleEmbedding(w: number, dim: number): Float32Array {
  const half = Math.floor(dim / 2);
  const out = new Float32Array(dim);
  const logBase = Math.log(10000) / Math.max(1, half - 1);
  const wScaled = w * 1000;
  for (let i = 0; i < half; i++) {
    const freq = Math.exp(-logBase * i);
    out[i] = Math.sin(wScaled * freq);
    if (half + i < dim) out[half + i] = Math.cos(wScaled * freq);
  }
  return out;
}

// ---------------------------------------------------------------------------
// DDPM noise schedule — precomputed alpha_cumprod for the standard SD beta
// schedule (scaled_linear, beta_start=0.00085, beta_end=0.012, T=1000).
// Used by BOTH models since both fine-tuned on the same base schedule.
// ---------------------------------------------------------------------------

const ALPHAS_CUMPROD = computeAlphasCumprod(0.00085, 0.012, 1000);

function computeAlphasCumprod(betaStart: number, betaEnd: number, T: number): Float32Array {
  const out = new Float32Array(T);
  const sqrtStart = Math.sqrt(betaStart);
  const sqrtEnd = Math.sqrt(betaEnd);
  let running = 1.0;
  for (let t = 0; t < T; t++) {
    const sqrtBeta = sqrtStart + (sqrtEnd - sqrtStart) * (t / (T - 1));
    const beta = sqrtBeta * sqrtBeta;
    running *= 1 - beta;
    out[t] = running;
  }
  return out;
}

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

/** Single emit point: log to console AND fan out to the consumer callback.
 *  No silent phases — if the engine is doing something, this fires. */
export function reportProgress(
  label: string,
  onProgress: ((label: string) => void) | undefined,
): void {
  // eslint-disable-next-line no-console
  console.info(`[builderforce-studio] ${label}`);
  onProgress?.(label);
}

export interface DenoiseInputs {
  /** Initial latent of shape [1, 4, height/8, width/8]. */
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
  /** Optional per-step progress callback ("denoise step 2/4 for frame 3/24"). */
  onStep?: (step: number, totalSteps: number) => void;
}

export interface DenoiseResult {
  /** Final decoded RGB pixel data, [-1..1] range, layout [3, height, width]. */
  pixels: Float32Array;
}

export class DiffusionEngine {
  private tokenizer: PreTrainedTokenizer | null = null;
  private textEncoderSession: ort.InferenceSession | null = null;
  private unetSession: ort.InferenceSession | null = null;
  private vaeSession: ort.InferenceSession | null = null;

  constructor(private readonly opts: DiffusionEngineOptions) {}

  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    const d = this.descriptor;
    const sessionOptions = this.buildSessionOptions();
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

    reportProgress(`Loading CLIP tokenizer (${d.tokenizerRepo})…`, onProgress);
    this.tokenizer = await AutoTokenizer.from_pretrained(d.tokenizerRepo);
    reportProgress('Tokenizer ready.', onProgress);

    reportProgress(`Loading ${d.id} weights (UNet + text-encoder + VAE)…`, onProgress);
    [this.textEncoderSession, this.unetSession, this.vaeSession] = await Promise.all([
      this.createSession(d.files.textEncoder, sessionOptions, 'text_encoder'),
      this.createSession(d.files.unet, sessionOptions, 'unet'),
      this.createSession(d.files.vaeDecoder, sessionOptions, 'vae_decoder'),
    ]);
    reportProgress('All ORT sessions created.', onProgress);

    // Validate the loaded models' input names match what the registry declares.
    // Catches model-vs-registry drift at init time with a clear error instead
    // of an opaque "input 'X' is missing in 'feeds'" on the first run.
    assertSessionMatchesSpec('unet', this.unetSession, d.unetInputs);
    assertSessionMatchesSpec('text_encoder', this.textEncoderSession, d.textEncoderInputs);
    reportProgress('Model graph contract verified — engine ready.', onProgress);
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  get descriptor(): ModelDescriptor {
    return MODEL_REGISTRY[this.opts.model];
  }

  get activeDevice(): ActiveDevice {
    return this.opts.probed.kind;
  }

  /** Tokenise (transformers.js) then run the CLIP text encoder (raw ORT) →
   *  conditioning embedding [1, seqLen, embedDim]. */
  async embedPrompt(prompt: string): Promise<Float32Array> {
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

    const out = await this.textEncoderSession.run({ [inputIdsSpec.name]: idTensor });
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

  /** Sample a fresh latent from deterministic gaussian noise. */
  sampleInitialLatent(seed: number): Float32Array {
    const latentH = this.opts.height / 8;
    const latentW = this.opts.width / 8;
    return gaussianNoise(1 * 4 * latentH * latentW, seed);
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

    const latentH = this.opts.height / 8;
    const latentW = this.opts.width / 8;
    const latentShape: [number, number, number, number] = [1, 4, latentH, latentW];

    const timesteps = inputs.timesteps ?? this.descriptor.defaultTimesteps;
    let sample = new Float32Array(inputs.latent);

    for (let i = 0; i < timesteps.length; i++) {
      inputs.onStep?.(i + 1, timesteps.length);
      const t = timesteps[i];
      const alpha = ALPHAS_CUMPROD[t] ?? 0.001;
      const sqrtAlpha = Math.sqrt(alpha);
      const sqrtOneMinusAlpha = Math.sqrt(1 - alpha);

      // 1) UNet predicts noise (with optional CFG)
      const noisePred = await this.runUnet({
        sample,
        condEmbedding: inputs.condEmbedding,
        uncondEmbedding: inputs.uncondEmbedding,
        timestep: t,
        guidance: inputs.guidance,
        latentShape,
      });

      // 2) Compute predicted_x0 (LCM consistency model output)
      const predictedX0 = new Float32Array(sample.length);
      for (let j = 0; j < sample.length; j++) {
        predictedX0[j] = (sample[j] - sqrtOneMinusAlpha * noisePred[j]) / sqrtAlpha;
      }

      // 3) Re-noise to next timestep (or finalise on last step)
      if (i < timesteps.length - 1) {
        const tNext = timesteps[i + 1];
        const alphaNext = ALPHAS_CUMPROD[tNext] ?? 0.001;
        const sqrtAlphaNext = Math.sqrt(alphaNext);
        const sqrtOneMinusAlphaNext = Math.sqrt(1 - alphaNext);
        const noise = gaussianNoise(sample.length, inputs.seed + i * 7919);
        for (let j = 0; j < sample.length; j++) {
          sample[j] = sqrtAlphaNext * predictedX0[j] + sqrtOneMinusAlphaNext * noise[j];
        }
      } else {
        sample = predictedX0;
      }
    }

    const pixels = await this.runVaeDecode(sample, latentH, latentW);
    return { pixels };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private buildSessionOptions(): ort.InferenceSession.SessionOptions {
    return buildOrtSessionOptions(this.opts.probed.kind);
  }

  /** Create an ORT session for one model file, attaching its external-data
   *  sidecar when the export splits weights into a `.onnx_data` blob.
   *  Emits per-file phase progress so the user sees which model is loading. */
  private async createSession(
    file: OnnxFile,
    baseOptions: ort.InferenceSession.SessionOptions,
    label: string,
  ): Promise<ort.InferenceSession> {
    const onProgress = this.opts.onProgress;
    reportProgress(`Downloading ${label} (${file.model})…`, onProgress);
    const modelBuf = await this.fetchWeight(file.model);
    const options: ort.InferenceSession.SessionOptions = { ...baseOptions };

    if (file.externalData) {
      reportProgress(`Downloading ${label} weight data (${file.externalData})…`, onProgress);
      const dataBuf = await this.fetchWeight(file.externalData);
      // The .onnx graph references its sidecar by basename (e.g.
      // 'model.onnx_data'); ORT matches the externalData `path` against it.
      options.externalData = [
        { path: basename(file.externalData), data: new Uint8Array(dataBuf) },
      ];
    }
    reportProgress(`Creating ${label} ORT session…`, onProgress);
    try {
      const session = await ort.InferenceSession.create(new Uint8Array(modelBuf), options);
      reportProgress(`${label} ready.`, onProgress);
      return session;
    } catch (err) {
      throw explainSessionCreateError(err, label, this.descriptor.id, this.descriptor.minVramMb);
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
    const ctx: UnetInputContext = {
      descriptor: this.descriptor,
      sample: args.sample,
      condEmbedding: args.condEmbedding,
      timestep: args.timestep,
      guidance: args.guidance,
      latentShape: args.latentShape,
    };
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
    const condFeeds = this.buildUnetFeeds({
      sample: args.sample,
      condEmbedding: args.condEmbedding,
      timestep: args.timestep,
      guidance: args.guidance,
      latentShape: args.latentShape,
    });
    const condOut = await session.run(condFeeds);
    const condNoise = pickFirstFloat32(condOut);
    if (!condNoise) throw new Error('UNet returned no Float32 output');

    if (!args.uncondEmbedding || args.guidance <= 0) {
      return condNoise;
    }

    const uncondFeeds = this.buildUnetFeeds({
      sample: args.sample,
      condEmbedding: args.uncondEmbedding,
      timestep: args.timestep,
      guidance: args.guidance,
      latentShape: args.latentShape,
    });
    const uncondOut = await session.run(uncondFeeds);
    const uncondNoise = pickFirstFloat32(uncondOut);
    if (!uncondNoise) throw new Error('UNet unconditional pass returned no Float32 output');

    const guided = new Float32Array(condNoise.length);
    for (let i = 0; i < condNoise.length; i++) {
      guided[i] = uncondNoise[i] + args.guidance * (condNoise[i] - uncondNoise[i]);
    }
    return guided;
  }

  private async runVaeDecode(latent: Float32Array, h: number, w: number): Promise<Float32Array> {
    const session = this.vaeSession!;
    const scaled = new Float32Array(latent.length);
    const scale = this.descriptor.vaeScalingFactor;
    for (let i = 0; i < latent.length; i++) scaled[i] = latent[i] / scale;
    const input = new ort.Tensor('float32', scaled, [1, 4, h, w]);
    const out = await session.run({ latent_sample: input });
    const pixels = pickFirstFloat32(out);
    if (!pixels) throw new Error('VAE decoder returned no Float32 output');
    return pixels;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Float32 gaussian noise via Box-Muller. Single deterministic helper used by
 * both `sampleInitialLatent` and the LCM re-noise step so the seed contract
 * is consistent across the pipeline.
 */
function gaussianNoise(length: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const u1 = (state + 1) / 0x100000000;
    state = (state * 1664525 + 1013904223) >>> 0;
    const u2 = (state + 1) / 0x100000000;
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return out;
}

/**
 * ORT sessions in transformers-exported SD models use varying output names
 * (`out_sample`, `sample`, `predicted_noise`). Pick the first Float32 tensor
 * the session emits so we don't fragile-match on a specific key.
 */
function pickFirstFloat32(result: ort.InferenceSession.OnnxValueMapType): Float32Array | null {
  for (const value of Object.values(result)) {
    const data = (value as ort.Tensor).data;
    if (data instanceof Float32Array) return data;
  }
  return null;
}

/**
 * Pre-flight memory check. Returns null when memory is sufficient (or unknown);
 * returns an error message when the probed memory is below the model's declared
 * minimum. Caller throws if the message is non-null.
 *
 * Why this exists: skipping the check sends the user into a multi-minute model
 * download that ends with the opaque ORT `std::bad_alloc` (ERROR_CODE 6). A
 * pre-flight check fails in milliseconds with an actionable message instead.
 *
 * `approxMemoryMb` of `null` means the device didn't report — we don't refuse
 * in that case (better to attempt and surface a real error than block on
 * unknowns), but a logged warning is the right shape.
 */
export function checkMemoryForModel(
  approxMemoryMb: number | null,
  minVramMb: number,
  modelId: string,
): string | null {
  if (approxMemoryMb === null) return null;
  if (approxMemoryMb >= minVramMb) return null;
  return (
    `Insufficient memory for ${modelId}: device reports ` +
    `~${(approxMemoryMb / 1024).toFixed(1)} GB available, ` +
    `model needs at least ~${(minVramMb / 1024).toFixed(1)} GB. ` +
    `${lighterModelHint(modelId)}`
  );
}

/** Suggest a lighter model from the registry — never the failing one. */
function lighterModelHint(failingModelId: string): string {
  const alternatives = Object.keys(MODEL_REGISTRY).filter((id) => id !== failingModelId);
  if (alternatives.length === 0) {
    return 'Close other GPU-heavy tabs and retry.';
  }
  return `Try a lighter model (${alternatives.join(', ')}) or close other GPU-heavy tabs.`;
}

/**
 * Translate ORT's opaque session-create errors into actionable diagnostics.
 * Wraps `InferenceSession.create()` so a `std::bad_alloc` becomes a sentence
 * the user can act on, not a stack trace into the WASM runtime.
 */
export function explainSessionCreateError(
  err: unknown,
  label: string,
  modelId: string,
  minVramMb: number,
): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/bad_alloc|out of memory|memory access out of bounds/i.test(message)) {
    return new Error(
      `Out of memory while creating the ${label} ORT session for ${modelId} ` +
        `(needs ~${(minVramMb / 1024).toFixed(1)} GB). ` +
        `${lighterModelHint(modelId)} ` +
        `Original error: ${message}`,
    );
  }
  if (/InsertedPrecisionFreeCast|SimplifiedLayerNormFusion|graph_utils\.cc/.test(message)) {
    return new Error(
      `${label} ORT session refused to load due to a graph-fusion crash. ` +
        `This usually means graphOptimizationLevel is too aggressive — verify ` +
        `buildOrtSessionOptions still pins 'basic'. Original error: ${message}`,
    );
  }
  return err instanceof Error ? err : new Error(message);
}

/**
 * Build ORT session options for a probed device.
 *
 * `graphOptimizationLevel: 'basic'` is critical — ORT-web's default `'all'`
 * runs extended fusions (SimplifiedLayerNormFusion, ConstantFolding for
 * inserted Casts) that crash on most browser-exported SD / SD-Turbo / LCM
 * text-encoders with errors like:
 *
 *   "Attempting to get index by a name which does not exist:
 *    InsertedPrecisionFreeCast_/text_model/final_layer_norm/Constant_output_0
 *    for node /text_model/encoder/layers.0/layer_norm1/Mul/SimplifiedLayerNormFusion/"
 *
 * `'basic'` skips the entire extended-fusion pass while keeping the cheap
 * constant-folding optimizations that don't touch the layout. Matches what
 * Microsoft's ORT-web SD-Turbo demo and aislamov's diffusers-js demos use.
 */
export function buildOrtSessionOptions(
  device: ActiveDevice,
): ort.InferenceSession.SessionOptions {
  const base: ort.InferenceSession.SessionOptions = { graphOptimizationLevel: 'basic' };
  if (device === 'webnn') return { ...base, executionProviders: ['webnn', 'wasm'] };
  if (device === 'webgpu') return { ...base, executionProviders: ['webgpu', 'wasm'] };
  return { ...base, executionProviders: ['wasm'] };
}

/** Last path segment — the name an .onnx graph uses to reference its sidecar. */
function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** Init-time drift check: every input the registry declares for `session`
 *  must exist in `session.inputNames`. Throws with a clear, actionable error
 *  if the model and the registry disagree. */
function assertSessionMatchesSpec(
  sessionLabel: string,
  session: ort.InferenceSession,
  specs: readonly OrtInputSpec[],
): void {
  const declared = specs.map((s) => s.name);
  const actual = session.inputNames;
  const missing = declared.filter((n) => !actual.includes(n));
  if (missing.length > 0) {
    throw new Error(
      `Registry/model mismatch on ${sessionLabel}: declared input(s) [${missing.join(', ')}] ` +
        `are not in the model's inputNames [${actual.join(', ')}]. ` +
        `Update MODEL_REGISTRY in diffusion-engine.ts to match the actual export.`,
    );
  }
}

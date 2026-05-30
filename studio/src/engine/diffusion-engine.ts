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
    unetInputNames: ['sample', 'timestep', 'encoder_hidden_states', 'timestep_cond'],
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
    unetInputNames: ['sample', 'timestep', 'encoder_hidden_states'],
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

type UnetInputBuilder = (ctx: UnetInputContext) => ort.Tensor;

const UNET_INPUT_BUILDERS: Record<string, UnetInputBuilder> = {
  sample: (ctx) => new ort.Tensor('float32', ctx.sample, ctx.latentShape),
  timestep: (ctx) =>
    new ort.Tensor('int64', BigInt64Array.from([BigInt(ctx.timestep)]), [1]),
  encoder_hidden_states: (ctx) =>
    new ort.Tensor('float32', ctx.condEmbedding, [
      1,
      ctx.descriptor.sequenceLength,
      ctx.descriptor.textEmbedDim,
    ]),
  timestep_cond: (ctx) => {
    // LCM consistency-model guidance-scale embedding. Diffusers convention:
    // embed (w - 1) where w is the CFG scale. w=1 (LCM default) → all zeros.
    const dim = ctx.descriptor.lcmGuidanceEmbedDim ?? 256;
    const data = guidanceScaleEmbedding(ctx.guidance - 1, dim);
    return new ort.Tensor('float32', data, [1, dim]);
  },
};

/** Names the engine knows how to build. Exported so the registry contract test
 *  can assert every model's `unetInputNames` is a subset of this. */
export const KNOWN_UNET_INPUTS: ReadonlySet<string> = new Set(
  Object.keys(UNET_INPUT_BUILDERS),
);

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

    // transformers.js does ONLY tokenization — the CLIP BPE tokenizer is the
    // one piece we don't want to hand-roll. Everything else is raw ORT.
    this.tokenizer = await AutoTokenizer.from_pretrained(d.tokenizerRepo);

    // Text encoder, UNet, VAE decoder — all raw ORT sessions (with external
    // data sidecars where the export splits weights >2GB).
    [this.textEncoderSession, this.unetSession, this.vaeSession] = await Promise.all([
      this.createSession(d.files.textEncoder, sessionOptions),
      this.createSession(d.files.unet, sessionOptions),
      this.createSession(d.files.vaeDecoder, sessionOptions),
    ]);
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

    // diffusers ONNX text encoders take int32 `input_ids` of shape [1, seqLen].
    const rawIds = encoded.input_ids.data as ArrayLike<bigint | number>;
    const ids = Int32Array.from({ length: sequenceLength }, (_unused, i) =>
      i < rawIds.length ? Number(rawIds[i]) : 0,
    );
    const idTensor = new ort.Tensor('int32', ids, [1, sequenceLength]);

    const out = await this.textEncoderSession.run({ input_ids: idTensor });
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
    const kind = this.opts.probed.kind;
    if (kind === 'webnn') return { executionProviders: ['webnn', 'wasm'] };
    if (kind === 'webgpu') return { executionProviders: ['webgpu', 'wasm'] };
    return { executionProviders: ['wasm'] };
  }

  /** Create an ORT session for one model file, attaching its external-data
   *  sidecar when the export splits weights into a `.onnx_data` blob. */
  private async createSession(
    file: OnnxFile,
    baseOptions: ort.InferenceSession.SessionOptions,
  ): Promise<ort.InferenceSession> {
    const modelBuf = await this.fetchWeight(file.model);
    const options: ort.InferenceSession.SessionOptions = { ...baseOptions };

    if (file.externalData) {
      const dataBuf = await this.fetchWeight(file.externalData);
      // The .onnx graph references its sidecar by basename (e.g.
      // 'model.onnx_data'); ORT matches the externalData `path` against it.
      options.externalData = [
        { path: basename(file.externalData), data: new Uint8Array(dataBuf) },
      ];
    }
    return ort.InferenceSession.create(new Uint8Array(modelBuf), options);
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
    for (const name of this.descriptor.unetInputNames) {
      const builder = UNET_INPUT_BUILDERS[name];
      if (!builder) {
        throw new Error(
          `Model '${this.descriptor.id}' declares UNet input '${name}' but no builder is registered. ` +
            `Add it to UNET_INPUT_BUILDERS in diffusion-engine.ts.`,
        );
      }
      feeds[name] = builder(ctx);
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

/** Last path segment — the name an .onnx graph uses to reference its sidecar. */
function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

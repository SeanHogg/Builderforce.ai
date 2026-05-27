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
import {
  env as hfEnv,
  AutoTokenizer,
  AutoModel,
  type PreTrainedTokenizer,
  type PreTrainedModel,
} from '@huggingface/transformers';
import type {
  ActiveDevice,
  DiffusionModelId,
  ModelDescriptor,
  WeightSource,
} from '../types';
import type { ProbedDevice } from './device-router';
import { getOrFetchWeight } from './weight-cache';

// transformers.js global configuration — idempotent so safe alongside the
// frontend's existing hfEnv usage in webgpu-trainer.ts.
hfEnv.allowLocalModels = false;
if (hfEnv.backends?.onnx?.wasm) {
  hfEnv.backends.onnx.wasm.numThreads = 1;
}

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
    hfRepo: 'Xenova/LCM_Dreamshaper_v7-onnx',
    textEmbedDim: 768,
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999, 759, 519, 259],
    files: {
      unet: 'unet/model_fp16.onnx',
      vaeDecoder: 'vae_decoder/model_fp16.onnx',
    },
  },
  'sd-turbo': {
    id: 'sd-turbo',
    defaultSteps: 1,
    defaultGuidance: 0.0, // SD-Turbo is unconditional CFG
    minVramMb: 4 * 1024,
    hfRepo: 'Xenova/sd-turbo',
    textEmbedDim: 1024,
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999],
    files: {
      unet: 'unet/model_fp16.onnx',
      vaeDecoder: 'vae_decoder/model_fp16.onnx',
    },
  },
};

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
  private textEncoder: PreTrainedModel | null = null;
  private unetSession: ort.InferenceSession | null = null;
  private vaeSession: ort.InferenceSession | null = null;

  constructor(private readonly opts: DiffusionEngineOptions) {}

  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    const descriptor = this.descriptor;
    const sessionOptions = this.buildSessionOptions();
    const hfDevice = this.mapDeviceToHf();
    const hfDtype = hfDevice === 'webgpu' ? 'fp16' : 'fp32';

    // 1. Tokenizer + text encoder via transformers.js (extension layer)
    this.tokenizer = await AutoTokenizer.from_pretrained(descriptor.hfRepo);
    this.textEncoder = await AutoModel.from_pretrained(descriptor.hfRepo, {
      subfolder: 'text_encoder',
      device: hfDevice,
      dtype: hfDtype,
    });

    // 2. UNet + VAE via raw ORT (base layer — keeps mid-step control)
    const [unetBuf, vaeBuf] = await Promise.all([
      this.fetchWeight(descriptor.files.unet),
      this.fetchWeight(descriptor.files.vaeDecoder),
    ]);
    this.unetSession = await ort.InferenceSession.create(new Uint8Array(unetBuf), sessionOptions);
    this.vaeSession = await ort.InferenceSession.create(new Uint8Array(vaeBuf), sessionOptions);
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

  /** Tokenise and encode the prompt → conditioning embedding [1, seqLen, embedDim]. */
  async embedPrompt(prompt: string): Promise<Float32Array> {
    if (!this.tokenizer || !this.textEncoder) {
      throw new Error('DiffusionEngine.init() not called');
    }
    const { textEmbedDim, sequenceLength } = this.descriptor;
    const encoded = await this.tokenizer(prompt, {
      padding: 'max_length',
      max_length: sequenceLength,
      truncation: true,
      return_tensors: 'pt',
    });

    const out: { last_hidden_state?: { data: Float32Array }; text_embeds?: { data: Float32Array } } =
      await this.textEncoder({ input_ids: encoded.input_ids });

    const hidden = out.last_hidden_state?.data;
    if (!hidden) {
      throw new Error('Text encoder returned no last_hidden_state');
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

  private mapDeviceToHf(): 'webgpu' | 'webnn' | 'wasm' {
    const kind = this.opts.probed.kind;
    if (kind === 'webgpu') return 'webgpu';
    if (kind === 'webnn') return 'webnn';
    return 'wasm';
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

  private async runUnet(args: {
    sample: Float32Array;
    condEmbedding: Float32Array;
    uncondEmbedding: Float32Array | null;
    timestep: number;
    guidance: number;
    latentShape: [number, number, number, number];
  }): Promise<Float32Array> {
    const session = this.unetSession!;
    const { textEmbedDim, sequenceLength } = this.descriptor;
    const sampleTensor = new ort.Tensor('float32', args.sample, args.latentShape);
    const tsTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(args.timestep)]), [1]);
    const condTensor = new ort.Tensor(
      'float32',
      args.condEmbedding,
      [1, sequenceLength, textEmbedDim],
    );

    const condOut = await session.run({
      sample: sampleTensor,
      timestep: tsTensor,
      encoder_hidden_states: condTensor,
    });
    const condNoise = pickFirstFloat32(condOut);
    if (!condNoise) throw new Error('UNet returned no Float32 output');

    if (!args.uncondEmbedding || args.guidance <= 0) {
      return condNoise;
    }

    const uncondTensor = new ort.Tensor(
      'float32',
      args.uncondEmbedding,
      [1, sequenceLength, textEmbedDim],
    );
    const uncondOut = await session.run({
      sample: sampleTensor,
      timestep: tsTensor,
      encoder_hidden_states: uncondTensor,
    });
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

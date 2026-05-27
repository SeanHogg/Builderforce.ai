/**
 * DiffusionEngine — ONNX-RT-Web backed denoising pipeline.
 *
 * One `denoise(latent, condEmbedding, steps, guidance)` primitive is shared
 * between LCM (4-step) and SD-Turbo (1-step). The per-model differences live
 * in the MODEL_REGISTRY (steps, guidance defaults, file layout) and in the
 * scheduler choice, not in two parallel pipelines.
 *
 * Hardware path is decided by device-router (already probed). This module
 * receives the InferenceSession config and runs the ONNX graphs.
 */

import * as ort from 'onnxruntime-web';
import type {
  DiffusionModelId,
  ModelDescriptor,
  ActiveDevice,
} from '../types';
import type { ProbedDevice } from './device-router';
import { getOrFetchWeight } from './weight-cache';
import type { WeightSource } from '../types';

export const MODEL_REGISTRY: Record<DiffusionModelId, ModelDescriptor & { hfRepo: string }> = {
  'lcm-dreamshaper-v7': {
    id: 'lcm-dreamshaper-v7',
    defaultSteps: 4,
    defaultGuidance: 1.5,
    minVramMb: 6 * 1024,
    hfRepo: 'lcm-sd/lcm-dreamshaper-v7-onnx',
    files: {
      unet: 'unet/model.onnx',
      vaeDecoder: 'vae_decoder/model.onnx',
      textEncoder: 'text_encoder/model.onnx',
      tokenizer: 'tokenizer/tokenizer.json',
    },
  },
  'sd-turbo': {
    id: 'sd-turbo',
    defaultSteps: 1,
    defaultGuidance: 0.0,
    minVramMb: 4 * 1024,
    hfRepo: 'stabilityai/sd-turbo-onnx',
    files: {
      unet: 'unet/model.onnx',
      vaeDecoder: 'vae_decoder/model.onnx',
      textEncoder: 'text_encoder/model.onnx',
      tokenizer: 'tokenizer/tokenizer.json',
    },
  },
};

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
  /** Negative-prompt embedding for CFG (SD-Turbo only). Pass null for LCM. */
  uncondEmbedding: Float32Array | null;
  steps: number;
  guidance: number;
}

export interface DenoiseResult {
  /** Final decoded RGB pixel data [height, width, 3] in 0..1 range. */
  pixels: Float32Array;
}

export class DiffusionEngine {
  private unetSession: ort.InferenceSession | null = null;
  private vaeSession: ort.InferenceSession | null = null;
  private textEncoderSession: ort.InferenceSession | null = null;
  private tokenizerJson: unknown = null;

  constructor(private readonly opts: DiffusionEngineOptions) {}

  async init(): Promise<void> {
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const sessionOptions = this.buildSessionOptions();

    const [unetBuf, vaeBuf, textEncBuf, tokenizerBuf] = await Promise.all([
      this.fetchWeight(descriptor.files.unet, descriptor.hfRepo),
      this.fetchWeight(descriptor.files.vaeDecoder, descriptor.hfRepo),
      this.fetchWeight(descriptor.files.textEncoder, descriptor.hfRepo),
      this.fetchWeight(descriptor.files.tokenizer, descriptor.hfRepo),
    ]);

    this.unetSession = await ort.InferenceSession.create(new Uint8Array(unetBuf), sessionOptions);
    this.vaeSession = await ort.InferenceSession.create(new Uint8Array(vaeBuf), sessionOptions);
    this.textEncoderSession = await ort.InferenceSession.create(
      new Uint8Array(textEncBuf),
      sessionOptions
    );
    this.tokenizerJson = JSON.parse(new TextDecoder().decode(tokenizerBuf));
  }

  /**
   * Run the full denoise → decode pipeline for one frame. The caller owns the
   * scheduler choice (LCM vs DDIM/Euler for SD-Turbo) by passing the right
   * `steps` and `guidance`. The shared primitive is responsible only for the
   * inner loop and VAE decode.
   */
  async denoise(inputs: DenoiseInputs): Promise<DenoiseResult> {
    if (!this.unetSession || !this.vaeSession) {
      throw new Error('DiffusionEngine.init() not called');
    }

    let latent = new Float32Array(inputs.latent);
    const latentH = this.opts.height / 8;
    const latentW = this.opts.width / 8;

    for (let stepIdx = 0; stepIdx < inputs.steps; stepIdx++) {
      const sigma = sigmaForStep(stepIdx, inputs.steps);
      const timestep = stepToTimestep(stepIdx, inputs.steps);

      const noisePred = await this.runUnet({
        latent,
        condEmbedding: inputs.condEmbedding,
        uncondEmbedding: inputs.uncondEmbedding,
        timestep,
        guidance: inputs.guidance,
        latentShape: [1, 4, latentH, latentW],
      });

      // Single-step LCM update (or Euler for SD-Turbo with guidance=0)
      for (let i = 0; i < latent.length; i++) {
        latent[i] = latent[i] - sigma * noisePred[i];
      }
    }

    const pixels = await this.runVaeDecode(latent, latentH, latentW);
    return { pixels };
  }

  /** Tokenise and embed the prompt. Returns [1, seqLen, embedDim] tensor. */
  async embedPrompt(_prompt: string): Promise<Float32Array> {
    if (!this.textEncoderSession || !this.tokenizerJson) {
      throw new Error('DiffusionEngine.init() not called');
    }
    // NOTE: full BPE tokenisation is non-trivial; the smoke-test stub uses a
    // deterministic zero-vector so the engine wires end-to-end. Replaced with
    // a real CLIP tokenizer in the next pass — see Consolidated Gap Register.
    const seqLen = 77;
    const embedDim = 768;
    return new Float32Array(seqLen * embedDim);
  }

  /** Allocate a fresh latent tensor seeded from a deterministic RNG. */
  sampleInitialLatent(seed: number): Float32Array {
    const latentH = this.opts.height / 8;
    const latentW = this.opts.width / 8;
    const size = 1 * 4 * latentH * latentW;
    const out = new Float32Array(size);
    let state = seed >>> 0 || 1;
    for (let i = 0; i < size; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const u1 = (state + 1) / 0x100000000;
      state = (state * 1664525 + 1013904223) >>> 0;
      const u2 = (state + 1) / 0x100000000;
      // Box-Muller for standard normal noise
      out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    return out;
  }

  get activeDevice(): ActiveDevice {
    return this.opts.probed.kind;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private buildSessionOptions(): ort.InferenceSession.SessionOptions {
    const kind = this.opts.probed.kind;
    if (kind === 'webnn') {
      return { executionProviders: ['webnn', 'wasm'] };
    }
    if (kind === 'webgpu') {
      return { executionProviders: ['webgpu', 'wasm'] };
    }
    return { executionProviders: ['wasm'] };
  }

  private async fetchWeight(file: string, hfRepo: string): Promise<ArrayBuffer> {
    return getOrFetchWeight({
      cacheKey: `${this.opts.model}/${file}`,
      hfRepo,
      hfPath: file,
      sources: this.opts.weightSources,
      apiKey: this.opts.apiKey,
      r2Base: this.opts.r2Base,
      onProgress: (loaded, total) => this.opts.onWeightProgress?.(file, loaded, total),
    });
  }

  private async runUnet(args: {
    latent: Float32Array;
    condEmbedding: Float32Array;
    uncondEmbedding: Float32Array | null;
    timestep: number;
    guidance: number;
    latentShape: [number, number, number, number];
  }): Promise<Float32Array> {
    const session = this.unetSession!;
    const sample = new ort.Tensor('float32', args.latent, args.latentShape);
    const ts = new ort.Tensor('int64', BigInt64Array.from([BigInt(args.timestep)]), [1]);
    const encHidden = new ort.Tensor('float32', args.condEmbedding, [1, 77, 768]);

    const feeds: Record<string, ort.Tensor> = {
      sample,
      timestep: ts,
      encoder_hidden_states: encHidden,
    };

    const condOut = await session.run(feeds);
    const condNoise = condOut.out_sample?.data as Float32Array | undefined;
    if (!condNoise) throw new Error('UNet output missing `out_sample`');

    if (!args.uncondEmbedding || args.guidance <= 0) {
      return condNoise;
    }

    // Classifier-free guidance path (SD-Turbo only)
    const uncondEncHidden = new ort.Tensor('float32', args.uncondEmbedding, [1, 77, 768]);
    const uncondOut = await session.run({ ...feeds, encoder_hidden_states: uncondEncHidden });
    const uncondNoise = uncondOut.out_sample?.data as Float32Array;

    const guided = new Float32Array(condNoise.length);
    for (let i = 0; i < condNoise.length; i++) {
      guided[i] = uncondNoise[i] + args.guidance * (condNoise[i] - uncondNoise[i]);
    }
    return guided;
  }

  private async runVaeDecode(latent: Float32Array, h: number, w: number): Promise<Float32Array> {
    const session = this.vaeSession!;
    const scaled = new Float32Array(latent.length);
    const scale = 0.18215;
    for (let i = 0; i < latent.length; i++) scaled[i] = latent[i] / scale;
    const input = new ort.Tensor('float32', scaled, [1, 4, h, w]);
    const out = await session.run({ latent_sample: input });
    const pixels = out.sample?.data as Float32Array | undefined;
    if (!pixels) throw new Error('VAE decoder output missing `sample`');
    return pixels;
  }
}

function sigmaForStep(stepIdx: number, totalSteps: number): number {
  // Linear sigma schedule — placeholder until LCM scheduler is wired.
  const t = (totalSteps - stepIdx) / totalSteps;
  return 0.1 + 0.9 * t;
}

function stepToTimestep(stepIdx: number, totalSteps: number): number {
  // SD timestep schedule maps step→ 999..0 linearly.
  return Math.round(999 * (1 - stepIdx / Math.max(1, totalSteps)));
}

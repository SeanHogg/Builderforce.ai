/**
 * Browser LoRA/QLoRA training.
 *
 * Unlike the previous implementation, LoRA settings in this module are not
 * decorative: the base model is frozen and only the low-rank A/B matrices are
 * optimised. The exported artifact is a standards-compliant safetensors file.
 *
 * The exact-gradient LoRA path currently executes on the CPU. WebGPU is used
 * only as a capability signal until the engine's equivalent WGSL path lands;
 * callers must not describe this class as GPU-accelerated training.
 */

import {
  BPETokenizer,
  EvermindLM,
  EvermindLMLoRA,
  importEvermind,
  tensorsToSafetensors,
  type BaseQuant,
  type EvermindLMConfig,
} from '@seanhogg/builderforce-memory-engine';
import { hasWebGPUSupport } from '@seanhogg/builderforce-studio';
import { downloadDataset, uploadArtifact, updateTrainingJob, streamTrainingLogs } from './api';
import type { TrainingLog } from './types';

export interface LoRAConfig {
  rank: number;
  alpha: number;
  targetModules: string[];
}

export interface TrainingParams {
  epochs: number;
  batchSize: number;
  learningRate: number;
  gradientAccumulationSteps: number;
  precision: 'float16' | 'int8';
  loraConfig: LoRAConfig;
}

export interface TrainingStep {
  epoch: number;
  step: number;
  loss: number;
  learningRate: number;
}

export type TrainingDataMode = 'local-only' | 'workspace';

export interface BrowserLoRAArtifact {
  bytes: ArrayBuffer;
  filename: string;
  format: 'safetensors';
  adapterBytes: number;
  baseBytes: number;
  trainableParams: number;
  baseParams: number;
}

export interface WebGPUTrainerOptions {
  modelId: string;
  workerUrl: string;
  projectId: string | number;
  jobId?: string;
  datasetId?: string;
  /** Local-only mode performs no dataset download, log stream, job update, or artifact upload. */
  dataMode?: TrainingDataMode;
  /** Optional portable Evermind base checkpoint. When omitted a deterministic browser base is created. */
  baseCheckpoint?: ArrayBuffer;
  /** Tokenizer paired with baseCheckpoint. A corpus tokenizer is learned when no checkpoint is supplied. */
  tokenizerSpec?: Parameters<BPETokenizer['loadHuggingFace']>[0];
  modelConfig?: Omit<EvermindLMConfig, 'vocabSize'>;
  onLog: (message: string) => void;
  onStep: (step: TrainingStep) => void;
  onEpochEnd: (epoch: number, avgLoss: number) => void;
  onArtifact?: (artifact: BrowserLoRAArtifact) => void;
  onComplete: (artifactKey: string) => void;
  onError: (error: Error) => void;
}

const BROWSER_LORA_MAX_PARAMS = 20e6;

export function canTrainInBrowser(maxParams: number): boolean {
  return maxParams <= BROWSER_LORA_MAX_PARAMS;
}

/** Conservative browser limit based on the exact-gradient implementation. */
export function shouldUseWebGPU(maxParams: number): boolean {
  return hasWebGPUSupport() && canTrainInBrowser(maxParams);
}

function parseJsonl(jsonl: string): string[] {
  return jsonl.split('\n').filter(Boolean).map((line) => {
    try {
      const ex = JSON.parse(line) as { instruction?: string; input?: string; output?: string };
      return [ex.instruction, ex.input, ex.output].filter(Boolean).join('\n').trim();
    } catch {
      return line.trim();
    }
  }).filter(Boolean);
}

function safeModelName(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Convert a real LoRA adapter to the PEFT-compatible safetensors container. */
export function exportLoRASafetensors(
  lora: EvermindLMLoRA,
  modelId: string,
  targetModule = 'embed_tokens',
  fp16 = true,
): Uint8Array {
  const { adapter } = lora;
  return tensorsToSafetensors([
    {
      name: `base_model.model.${targetModule}.lora_A.weight`,
      shape: [adapter.rank, adapter.cols],
      data: adapter.A,
    },
    {
      name: `base_model.model.${targetModule}.lora_B.weight`,
      shape: [adapter.rows, adapter.rank],
      data: adapter.B,
    },
  ], {
    fp16,
    metadata: {
      format: 'pt',
      peft_type: 'LORA',
      base_model_name_or_path: modelId,
      target_modules: targetModule,
      rank: String(adapter.rank),
      alpha: String(adapter.alpha),
      builderforce_format: 'evermind-lora-v1',
    },
  });
}

/** Real frozen-base LoRA trainer retained under the old export name for API compatibility. */
export class WebGPUTrainer {
  private stopped = false;
  private ready = false;
  private readonly options: WebGPUTrainerOptions;

  constructor(options: WebGPUTrainerOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    this.options.onLog('Initialising exact-gradient browser LoRA engine…');
    this.ready = true;
    this.options.onLog(
      hasWebGPUSupport()
        ? 'Browser LoRA ready (CPU exact gradients; WebGPU adapter kernels are not enabled yet).'
        : 'Browser LoRA ready (CPU exact gradients).',
    );
  }

  stop(): void {
    this.stopped = true;
    this.options.onLog('Training stop requested…');
  }

  async train(params: TrainingParams, localExamples: string[]): Promise<void> {
    if (!this.ready) throw new Error('Trainer not initialised. Call init() first.');
    this.stopped = false;
    const mode = this.options.dataMode ?? 'workspace';

    try {
      let examples = localExamples.map((item) => item.trim()).filter(Boolean);
      if (mode === 'workspace' && this.options.datasetId) {
        this.options.onLog(`Fetching workspace dataset ${this.options.datasetId}…`);
        examples = parseJsonl(await downloadDataset(this.options.datasetId));
      }
      if (examples.length === 0) throw new Error('No training text available.');

      if (mode === 'workspace' && this.options.jobId) {
        streamTrainingLogs(this.options.jobId, (log: TrainingLog) => {
          if (log.message) this.options.onLog(`[server] ${log.message}`);
        }).catch(() => undefined);
      }

      const tokenizer = new BPETokenizer();
      if (this.options.tokenizerSpec) tokenizer.loadHuggingFace(this.options.tokenizerSpec);
      else tokenizer.train(examples, { numMerges: Math.min(512, Math.max(64, examples.length * 8)) });

      const model = this.options.baseCheckpoint
        ? importEvermind(new Uint8Array(this.options.baseCheckpoint))
        : new EvermindLM({
            vocabSize: tokenizer.vocabSize,
            dModel: 96,
            numLayers: 2,
            hiddenDim: 192,
            seed: 0x42f0ce,
            ...this.options.modelConfig,
          });
      if (model.config.vocabSize !== tokenizer.vocabSize) {
        throw new Error(`Tokenizer vocabulary (${tokenizer.vocabSize}) does not match base model (${model.config.vocabSize}).`);
      }

      const quant: BaseQuant = params.precision === 'int8' ? 'int8' : 'fp16';
      const lora = new EvermindLMLoRA(model, {
        rank: params.loraConfig.rank,
        alpha: params.loraConfig.alpha,
        baseQuant: quant,
        seed: 0x10a0,
      });
      const sequences = examples.map((text) => tokenizer.encode(text, { addBos: true, addEos: true })).filter((s) => s.length > 1);
      if (sequences.length === 0) throw new Error('Tokenizer produced no trainable sequences.');

      const before = Float32Array.from(model.emb);
      this.options.onLog(`Training ${lora.adapter.numParams().toLocaleString()} adapter parameters; base weights are frozen.`);
      for (let epoch = 1; epoch <= params.epochs; epoch += 1) {
        if (this.stopped) return;
        const [loss = 0] = lora.fit(sequences, {
          epochs: 1,
          lr: params.learningRate,
          accumSteps: Math.max(1, params.gradientAccumulationSteps),
        });
        const step = { epoch, step: epoch, loss, learningRate: params.learningRate };
        this.options.onStep(step);
        this.options.onEpochEnd(epoch, loss);
        this.options.onLog(`Epoch ${epoch}/${params.epochs} — loss ${loss.toFixed(4)}`);
        if (mode === 'workspace' && this.options.jobId) {
          await updateTrainingJob(this.options.jobId, { status: 'running', currentEpoch: epoch, currentLoss: loss });
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      if (model.emb.some((value, index) => value !== before[index])) {
        throw new Error('Frozen-base invariant failed: base weights changed during LoRA training.');
      }

      const bytes = exportLoRASafetensors(lora, this.options.modelId, 'embed_tokens', params.precision === 'float16');
      const footprint = lora.footprint();
      const filename = `${safeModelName(this.options.modelId)}-adapter.safetensors`;
      const artifact: BrowserLoRAArtifact = {
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        filename,
        format: 'safetensors',
        ...footprint,
      };
      this.options.onArtifact?.(artifact);

      let artifactKey = `local://${filename}`;
      if (mode === 'workspace' && this.options.jobId) {
        const result = await uploadArtifact(this.options.jobId, artifact.bytes, {
          format: 'safetensors',
          filename,
          baseModel: this.options.modelId,
          rank: params.loraConfig.rank,
          alpha: params.loraConfig.alpha,
        });
        artifactKey = result.r2Key;
        await updateTrainingJob(this.options.jobId, { status: 'completed', currentEpoch: params.epochs, r2ArtifactKey: artifactKey });
      }
      this.options.onLog(`LoRA adapter ready: ${artifactKey}`);
      this.options.onComplete(artifactKey);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((this.options.dataMode ?? 'workspace') === 'workspace' && this.options.jobId) {
        await updateTrainingJob(this.options.jobId, { status: 'failed', errorMessage: err.message }).catch(() => undefined);
      }
      this.options.onError(err);
      throw err;
    }
  }

  destroy(): void {
    this.stopped = true;
    this.ready = false;
  }
}

export { WebGPUTrainer as BrowserLoRATrainer };
